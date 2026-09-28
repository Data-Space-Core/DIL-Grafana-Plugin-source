# DIL Dashboard Sharing app

Use **Share dashboard via DIL** from any panel menu to export a reference to
the whole saved dashboard. The authenticated Grafana API resolves the actual
UID and title. Unsaved edits must be saved before sharing.

Example export:

```json
{
  "type": "GrafanaDashboardReference",
  "title": "Weatherstation",
  "dataAddress": {
    "type": "GrafanaDashboard",
    "dashboardId": "weatherstation-uid"
  }
}
```

Use `dataAddress` for the DIL Grafana data source. `dashboardId` is the actual
Grafana UID, not the numeric database ID or an integrity checksum. No
`panelIds` restriction is emitted, so the reference covers all dashboard
panels supported by the provider adapter.

Grafana URL and service-account credentials remain in provider dataplane
configuration. This reference contains no dashboard body, panel queries,
annotations, credentials, or checksum.

Download returns this reference; Publish sends the same document to the
configured REST endpoint, which must support `GrafanaDashboardReference`.
Publishing does not itself negotiate an agreement or initiate a transfer.
This file is source configuration, not a dashboard import file. The consumer
retrieves a dashboard definition through the authorized dataplane flow. The
portable `GrafanaDashboard` response includes non-secret `dil` metadata for
automatic datasource creation during import; consumer dataplane tokens remain
in Grafana secure datasource settings.

The app uses the signed-in user's Grafana session for dashboard lookup.
The DIL publishing token remains in encrypted app settings and is used only
by the backend. Anonymous access is not required.
