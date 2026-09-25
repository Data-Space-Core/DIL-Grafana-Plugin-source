package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

const pluginID = "dataspacelab-dil-datasource"

type settings struct {
	ConnectorURL string `json:"connectorUrl"`
	AgreementID  string `json:"agreementId"`
	DatasetID    string `json:"datasetId"`
	OfferID      string `json:"offerId"`
	DashboardID  string `json:"dashboardId"`
	AllowHTTP    bool   `json:"allowHttp"`
}
type plugin struct {
	config settings
	token  string
	client *http.Client
}

func newInstance(_ context.Context, input backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	var config settings
	if err := json.Unmarshal(input.JSONData, &config); err != nil {
		return nil, errors.New("invalid DIL configuration")
	}
	u, err := url.Parse(config.ConnectorURL)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(config.AllowHTTP && u.Scheme == "http")) {
		return nil, errors.New("configure an HTTPS consumer dataplane URL")
	}
	if config.AgreementID == "" || config.DatasetID == "" || config.OfferID == "" || config.DashboardID == "" {
		return nil, errors.New("agreement, offer, dataset and dashboard IDs are required")
	}
	token := input.DecryptedSecureJSONData["connectorToken"]
	if token == "" {
		return nil, errors.New("connector token is required")
	}
	return &plugin{config, token, &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func requestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func (p *plugin) call(ctx context.Context, operation string, extra map[string]any) ([]byte, error) {
	payload := map[string]any{"protocolVersion": "1.0", "requestId": requestID(), "agreementId": p.config.AgreementID,
		"datasetId": p.config.DatasetID, "offerId": p.config.OfferID, "dashboardId": p.config.DashboardID}
	for key, val := range extra {
		payload[key] = val
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(p.config.ConnectorURL, "/")+"/grafana/consumer/"+operation, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	req.Header.Set("Content-Type", "application/json")
	response, err := p.client.Do(req)
	if err != nil {
		return nil, errors.New("DIL connector unavailable or request cancelled")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("DIL connector rejected %s (HTTP %d)", operation, response.StatusCode)
	}
	result, err := io.ReadAll(io.LimitReader(response.Body, 11*1024*1024+1))
	if err != nil || len(result) > 11*1024*1024 {
		return nil, errors.New("invalid or oversized DIL response")
	}
	return result, nil
}

func (p *plugin) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	result := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		var model struct {
			PanelID     string `json:"panelId"`
			TemplateRef string `json:"templateRef"`
		}
		if err := json.Unmarshal(q.JSON, &model); err != nil || model.PanelID == "" || model.TemplateRef == "" {
			result.Responses[q.RefID] = backend.DataResponse{Error: errors.New("select a shared panel and query template")}
			continue
		}
		points := q.MaxDataPoints
		if points < 1 {
			points = 1000
		}
		if points > 10000 {
			points = 10000
		}
		interval := q.Interval.Milliseconds()
		if interval < 1000 {
			interval = 1000
		}
		body, err := p.call(ctx, "query", map[string]any{"panelId": model.PanelID, "templateRef": model.TemplateRef, "maxDataPoints": points, "intervalMs": interval,
			"timeRange": map[string]string{"from": q.TimeRange.From.UTC().Format(time.RFC3339Nano), "to": q.TimeRange.To.UTC().Format(time.RFC3339Nano)}})
		if err != nil {
			result.Responses[q.RefID] = backend.DataResponse{Error: err}
			continue
		}
		var response struct {
			DataFrames []json.RawMessage `json:"dataFrames"`
		}
		if err = json.Unmarshal(body, &response); err != nil {
			result.Responses[q.RefID] = backend.DataResponse{Error: errors.New("invalid frame response")}
			continue
		}
		frames := data.Frames{}
		for _, raw := range response.DataFrames {
			var frame data.Frame
			if err = json.Unmarshal(raw, &frame); err != nil {
				break
			}
			frame.RefID = q.RefID
			frames = append(frames, &frame)
		}
		if err != nil {
			result.Responses[q.RefID] = backend.DataResponse{Error: errors.New("invalid Grafana data frame")}
		} else {
			result.Responses[q.RefID] = backend.DataResponse{Frames: frames}
		}
	}
	return result, nil
}

func (p *plugin) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	_, err := p.call(ctx, "manifest", nil)
	if err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "Finalized agreement and shared dashboard are accessible"}, nil
}

func (p *plugin) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	if req.Method != "GET" || strings.Trim(req.Path, "/") != "manifest" {
		return sender.Send(&backend.CallResourceResponse{Status: 404})
	}
	body, err := p.call(ctx, "manifest", nil)
	if err != nil {
		body, _ = json.Marshal(map[string]string{"message": err.Error()})
		return sender.Send(&backend.CallResourceResponse{Status: 502, Body: body, Headers: map[string][]string{"Content-Type": {"application/json"}}})
	}
	return sender.Send(&backend.CallResourceResponse{Status: 200, Body: body, Headers: map[string][]string{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}}})
}

func main() {
	if err := datasource.Manage(pluginID, newInstance, datasource.ManageOpts{}); err != nil {
		os.Exit(1)
	}
}
