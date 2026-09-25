package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/app"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
)

const (
	appID              = "dataspacelab-dil-dashboard-app"
	datasourcePluginID = "dataspacelab-dil-datasource"
	portableDatasource = "${DIL_DATASOURCE}"
	maxRequestBytes    = 5 * 1024 * 1024
)

var assetPattern = regexp.MustCompile(`^urn:(?:dil:asset|uuid):[^\s]+$`)

type appSettings struct {
	ConnectorEndpoint string `json:"connectorEndpoint"`
	AllowHTTP         bool   `json:"allowHttp"`
}

type sharingApp struct {
	settings appSettings
	token    string
	client   *http.Client
}

type shareRequest struct {
	Dashboard map[string]any `json:"dashboard"`
	Assets    []string       `json:"assets"`
}

type sharedDocument struct {
	Type       string         `json:"type"`
	Title      string         `json:"title"`
	Dashboard  map[string]any `json:"dashboard"`
	Datasource map[string]any `json:"datasource"`
	Assets     []string       `json:"assets"`
	Requires   map[string]any `json:"requires"`
	Integrity  map[string]any `json:"integrity"`
}

func newApp(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	var config appSettings
	if len(settings.JSONData) > 0 {
		if err := json.Unmarshal(settings.JSONData, &config); err != nil {
			return nil, errors.New("invalid DIL dashboard app configuration")
		}
	}
	return &sharingApp{
		settings: config,
		token:    settings.DecryptedSecureJSONData["connectorToken"],
		client: &http.Client{
			Timeout:       20 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func (a *sharingApp) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	if req.PluginContext.User == nil || (req.PluginContext.User.Role != "Admin" && req.PluginContext.User.Role != "Editor") {
		return sendJSON(sender, http.StatusForbidden, map[string]string{"message": "Editor or Admin role required"}, nil)
	}
	if req.Method == http.MethodGet && strings.Trim(req.Path, "/") == "status" {
		return sendJSON(sender, http.StatusOK, map[string]any{
			"configured": a.settings.ConnectorEndpoint != "" && a.token != "",
			"endpoint":   a.settings.ConnectorEndpoint,
		}, nil)
	}
	if req.Method != http.MethodPost || (strings.Trim(req.Path, "/") != "export" && strings.Trim(req.Path, "/") != "publish") {
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusNotFound})
	}
	if len(req.Body) > maxRequestBytes {
		return sendJSON(sender, http.StatusRequestEntityTooLarge, map[string]string{"message": "dashboard document is too large"}, nil)
	}
	var input shareRequest
	decoder := json.NewDecoder(bytes.NewReader(req.Body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || len(input.Dashboard) == 0 {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"message": "valid dashboard JSON is required"}, nil)
	}
	document, err := makePortable(input)
	if err != nil {
		return sendJSON(sender, http.StatusBadRequest, map[string]string{"message": err.Error()}, nil)
	}
	if strings.Trim(req.Path, "/") == "export" {
		return sendJSON(sender, http.StatusOK, document, map[string][]string{
			"Cache-Control":       {"no-store"},
			"Content-Disposition": {`attachment; filename="dil-dashboard.json"`},
		})
	}
	return a.publish(ctx, document, sender)
}

func (a *sharingApp) publish(ctx context.Context, document sharedDocument, sender backend.CallResourceResponseSender) error {
	endpoint, err := validateEndpoint(a.settings.ConnectorEndpoint, a.settings.AllowHTTP)
	if err != nil || a.token == "" {
		return sendJSON(sender, http.StatusFailedDependency, map[string]string{"message": "configure an HTTPS DIL Connector endpoint and token"}, nil)
	}
	body, _ := json.Marshal(document)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return sendJSON(sender, http.StatusBadGateway, map[string]string{"message": "invalid publish request"}, nil)
	}
	request.Header.Set("Authorization", "Bearer "+a.token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", appID+"/0.1.0")
	response, err := a.client.Do(request)
	if err != nil {
		return sendJSON(sender, http.StatusBadGateway, map[string]string{"message": "DIL Connector is unavailable"}, nil)
	}
	defer response.Body.Close()
	result, readErr := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if readErr != nil || len(result) > 1024*1024 {
		return sendJSON(sender, http.StatusBadGateway, map[string]string{"message": "invalid DIL Connector response"}, nil)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return sendJSON(sender, http.StatusBadGateway, map[string]any{
			"message": "DIL Connector rejected dashboard publication",
			"status":  response.StatusCode,
		}, nil)
	}
	var parsed any
	if len(result) == 0 || json.Unmarshal(result, &parsed) != nil {
		parsed = map[string]any{"status": "published"}
	}
	return sendJSON(sender, http.StatusOK, map[string]any{"status": "published", "connectorResponse": parsed}, map[string][]string{"Cache-Control": {"no-store"}})
}

func validateEndpoint(raw string, allowHTTP bool) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("invalid endpoint")
	}
	if parsed.Scheme != "https" && !(allowHTTP && parsed.Scheme == "http") {
		return "", errors.New("HTTPS endpoint required")
	}
	return parsed.String(), nil
}

func makePortable(input shareRequest) (sharedDocument, error) {
	encoded, err := json.Marshal(input.Dashboard)
	if err != nil {
		return sharedDocument{}, errors.New("dashboard cannot be encoded")
	}
	var dashboard map[string]any
	if err = json.Unmarshal(encoded, &dashboard); err != nil {
		return sharedDocument{}, errors.New("dashboard cannot be copied")
	}
	title, _ := dashboard["title"].(string)
	if strings.TrimSpace(title) == "" {
		return sharedDocument{}, errors.New("dashboard title is required")
	}
	delete(dashboard, "id")
	delete(dashboard, "uid")
	delete(dashboard, "version")
	dashboard["id"] = nil

	assets := make(map[string]struct{})
	for _, asset := range input.Assets {
		asset = strings.TrimSpace(asset)
		if !assetPattern.MatchString(asset) {
			return sharedDocument{}, fmt.Errorf("invalid DIL asset identifier: %s", asset)
		}
		assets[asset] = struct{}{}
	}
	portableWalk(dashboard, assets)
	assetList := make([]string, 0, len(assets))
	for asset := range assets {
		assetList = append(assetList, asset)
	}
	sort.Strings(assetList)

	canonical, err := canonicalJSON(dashboard)
	if err != nil {
		return sharedDocument{}, errors.New("dashboard cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return sharedDocument{
		Type:      "GrafanaDashboard",
		Title:     title,
		Dashboard: dashboard,
		Datasource: map[string]any{
			"pluginId":    datasourcePluginID,
			"placeholder": portableDatasource,
		},
		Assets: assetList,
		Requires: map[string]any{
			"grafana": ">=13.0.1",
			"plugin":  map[string]string{"id": datasourcePluginID, "version": ">=0.3.0"},
		},
		Integrity: map[string]any{"algorithm": "sha256", "dashboard": hex.EncodeToString(digest[:])},
	}, nil
}

func canonicalJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(output.Bytes(), []byte("\n")), nil
}

func portableWalk(value any, assets map[string]struct{}) {
	switch current := value.(type) {
	case map[string]any:
		if datasource, ok := current["datasource"].(map[string]any); ok {
			if datasource["type"] == datasourcePluginID {
				current["datasource"] = map[string]any{"type": datasourcePluginID, "uid": portableDatasource}
			}
		}
		for key, child := range current {
			if (key == "assetId" || key == "datasetId") && assetPattern.MatchString(fmt.Sprint(child)) {
				assets[fmt.Sprint(child)] = struct{}{}
			}
			portableWalk(child, assets)
		}
	case []any:
		for _, child := range current {
			portableWalk(child, assets)
		}
	case string:
		if assetPattern.MatchString(current) {
			assets[current] = struct{}{}
		}
	}
}

func sendJSON(sender backend.CallResourceResponseSender, status int, value any, extra map[string][]string) error {
	body, _ := json.Marshal(value)
	headers := map[string][]string{"Content-Type": {"application/json"}}
	for key, values := range extra {
		headers[key] = values
	}
	return sender.Send(&backend.CallResourceResponse{Status: status, Body: body, Headers: headers})
}

func main() {
	if err := app.Manage(appID, newApp, app.ManageOpts{}); err != nil {
		os.Exit(1)
	}
}
