package main

import (
	"encoding/json"
	"testing"
)

func TestMakePortableRemovesInstanceIdentityAndMapsDILDatasources(t *testing.T) {
	input := shareRequest{Dashboard: map[string]any{
		"id": float64(42), "uid": "provider-only", "version": float64(7), "title": "Portable & safe",
		"panels": []any{map[string]any{
			"datasource": map[string]any{"type": datasourcePluginID, "uid": "provider-uid"},
			"targets":    []any{map[string]any{"datasetId": "urn:dil:asset:temperature"}},
		}},
	}}
	document, err := makePortable(input)
	if err != nil {
		t.Fatal(err)
	}
	if document.Dashboard["id"] != nil || document.Dashboard["uid"] != nil || document.Dashboard["version"] != nil {
		t.Fatal("provider dashboard identity leaked into portable document")
	}
	if len(document.Assets) != 1 || document.Assets[0] != "urn:dil:asset:temperature" {
		t.Fatalf("asset discovery failed: %#v", document.Assets)
	}
	encoded, _ := json.Marshal(document.Dashboard)
	if string(encoded) == "" || !contains(string(encoded), portableDatasource) || contains(string(encoded), "provider-uid") {
		t.Fatalf("datasource was not made portable: %s", encoded)
	}
}

func TestMakePortableRejectsInvalidAssetsAndUntitledDashboard(t *testing.T) {
	if _, err := makePortable(shareRequest{Dashboard: map[string]any{"title": "ok"}, Assets: []string{"https://not-an-asset"}}); err == nil {
		t.Fatal("invalid asset accepted")
	}
	if _, err := makePortable(shareRequest{Dashboard: map[string]any{"panels": []any{}}}); err == nil {
		t.Fatal("untitled dashboard accepted")
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

func contains(value, part string) bool {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return true
		}
	}
	return false
}
