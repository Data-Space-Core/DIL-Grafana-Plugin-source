package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReferencePreservesUIDAndExcludesDashboardBody(t *testing.T) {
	input := shareRequest{Dashboard: map[string]any{
		"id": float64(42), "uid": "provider-only", "version": float64(7), "title": "Portable & safe",
		"panels": []any{map[string]any{
			"datasource": map[string]any{"type": datasourcePluginID, "uid": "provider-uid"},
			"targets":    []any{map[string]any{"datasetId": "urn:dil:asset:temperature"}},
		}},
	}}
	document, err := makeReference(input)
	if err != nil {
		t.Fatal(err)
	}
	if document.DataAddress["dashboardId"] != "provider-only" {
		t.Fatal("provider dashboard identity leaked into portable document")
	}
	encoded, _ := json.Marshal(document)
	if string(encoded) == "" || !contains(string(encoded), `"dashboardId":"provider-only"`) || contains(string(encoded), "provider-uid") || contains(string(encoded), `"panels"`) || contains(string(encoded), `"integrity"`) {
		t.Fatalf("datasource was not made portable: %s", encoded)
	}
}

func TestReferenceRejectsMissingUIDAndTitle(t *testing.T) {
	if _, err := makeReference(shareRequest{Dashboard: map[string]any{"title": "ok"}}); err == nil {
		t.Fatal("invalid asset accepted")
	}
	if _, err := makeReference(shareRequest{Dashboard: map[string]any{"panels": []any{}}}); err == nil {
		t.Fatal("untitled dashboard accepted")
	}
	if _, err := makeReference(shareRequest{Dashboard: map[string]any{"title": "metadata only"}}); err == nil {
		t.Fatal("metadata-only dashboard accepted")
	}
}

func TestEndpointValidationRequiresHTTPSUnlessExplicitlyAllowed(t *testing.T) {
	for _, raw := range []string{"http://connector.example/share", "https://user:secret@connector.example/share", "https://connector.example/share?token=bad"} {
		if _, err := validateEndpoint(raw, false); err == nil {
			t.Fatalf("unsafe endpoint accepted: %s", raw)
		}
	}
	if _, err := validateEndpoint("https://connector.example/share", false); err != nil {
		t.Fatal(err)
	}
	if _, err := validateEndpoint("http://localhost:8080/share", true); err != nil {
		t.Fatal(err)
	}
}

func TestCreateDataSourceUsesManagementTokenAndStableDashboardAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/mgmt/data-sources" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer management-secret" {
			t.Fatalf("management token was not sent")
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["transferType"] != "grafana-query" {
			t.Fatalf("unexpected transfer type: %v", payload["transferType"])
		}
		address := payload["dataAddress"].(map[string]any)
		if address["dashboardId"] != "weatherstation" {
			t.Fatalf("unexpected dashboard address: %v", address)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"@id":"urn:dil:grafana:dashboard:weatherstation"}`))
	}))
	defer server.Close()

	app := &sharingApp{
		settings:        appSettings{ManagementAPIURL: server.URL, AllowHTTP: true},
		managementToken: "management-secret",
		client:          server.Client(),
	}
	created, err := app.createDataSource(context.Background(), sharedDocument{
		Type: "GrafanaDashboardReference", Title: "Weatherstation",
		DataAddress: map[string]string{"type": "GrafanaDashboard", "dashboardId": "weatherstation"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.(map[string]any)["@id"] != "urn:dil:grafana:dashboard:weatherstation" {
		t.Fatalf("unexpected connector response: %v", created)
	}
}

func TestManagementDataSourceEndpointAddsConnectorRoute(t *testing.T) {
	endpoint, err := managementDataSourceEndpoint("https://connector.example", false)
	if err != nil || endpoint != "https://connector.example/mgmt/data-sources" {
		t.Fatalf("unexpected endpoint: %s (%v)", endpoint, err)
	}
	endpoint, err = managementDataSourceEndpoint("https://connector.example/mgmt", false)
	if err != nil || endpoint != "https://connector.example/mgmt/data-sources" {
		t.Fatalf("unexpected /mgmt endpoint: %s (%v)", endpoint, err)
	}
}

func contains(value, part string) bool {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
