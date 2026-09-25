package main

import (
	"context"
	"encoding/json"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestQueriesUseConsumerDataplaneAndReturnNativeFrames(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/grafana/consumer/query" || r.Header.Get("Authorization") != "Bearer private" {
			t.Error("incorrect consumer request")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["agreementId"] != "agreement" || body["requestId"] == "" || body["templateRef"] != "A" {
			t.Error("missing agreement binding")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"dataFrames":[{"schema":{"name":"temperature","fields":[{"name":"value","type":"number","typeInfo":{"frame":"float64"}}]},"data":{"values":[[21.4]]}}]}`))
	}))
	defer server.Close()
	p := &plugin{config: settings{ConnectorURL: server.URL, AgreementID: "agreement"}, token: "private", client: server.Client()}
	response, err := p.QueryData(context.Background(), &backend.QueryDataRequest{Queries: []backend.DataQuery{{RefID: "B", JSON: json.RawMessage(`{"panelId":"1","templateRef":"A"}`), MaxDataPoints: 1000, TimeRange: backend.TimeRange{From: time.Now().Add(-time.Hour), To: time.Now()}}}})
	if err != nil || response.Responses["B"].Error != nil {
		t.Fatalf("query failed: %v %v", err, response.Responses["B"].Error)
	}
	if len(response.Responses["B"].Frames) != 1 || response.Responses["B"].Frames[0].RefID != "B" {
		t.Fatal("frame not mapped")
	}
}

func TestUnsafeURLAndMissingCredentialsRejected(t *testing.T) {
	for _, raw := range []string{`{"connectorUrl":"https://user:pass@example.org"}`, `{"connectorUrl":"http://example.org"}`, `{"connectorUrl":"https://example.org?token=bad"}`} {
		if _, err := newInstance(context.Background(), backend.DataSourceInstanceSettings{JSONData: json.RawMessage(raw)}); err == nil {
			t.Fatal("unsafe configuration accepted")
		}
	}
}
