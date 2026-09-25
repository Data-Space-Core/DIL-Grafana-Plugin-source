# DIL dashboard sharing

The distribution contains two independent Grafana backend plugins:

- `dataspacelab-dil-datasource` executes consumer queries through a DIL
  dataplane and imports portable dashboard documents.
- `dataspacelab-dil-dashboard-app` is the provider companion. It adds the
  dashboard sharing action, converts dashboards to portable documents, and
  optionally publishes them to a configured DIL Connector REST endpoint.

Both target Grafana 13.0.1 and later. Neither modifies Grafana core or enables
anonymous access. Keycloak remains responsible for interactive login.

## Why the action is in a panel menu

Grafana 13.0.1 has no supported whole-dashboard toolbar extension point. App
plugins can add an action to `grafana/dashboard/panel/menu`, so the companion
registers **Share dashboard via DIL** there. Although launched from a panel, the
action exports the complete current dashboard model.

The app backend exposes authenticated Grafana plugin resources:

- `POST /api/plugins/dataspacelab-dil-dashboard-app/resources/export`
- `POST /api/plugins/dataspacelab-dil-dashboard-app/resources/publish`
- `GET /api/plugins/dataspacelab-dil-dashboard-app/resources/status`

Export and publish require an authenticated Editor or Admin. Connector tokens
are stored in `secureJsonData`, decrypted only for the backend process, and are
never returned to frontend JavaScript.

## Provider workflow

1. Install the dashboard app ZIP and allow/sign its plugin ID. Install the DIL
   datasource too when provider dashboards use it locally.
2. Enable **DIL Dashboard Sharing** for the Grafana organization.
3. Open `/a/dataspacelab-dil-dashboard-app/config` as an Admin.
4. Set the exact HTTPS Connector endpoint that accepts the shared document and
   its narrowly scoped publish token. Plain HTTP is an explicit development-only
   option.
5. Open a dashboard and choose **Share dashboard via DIL** from any panel menu.
6. Add asset URNs not already represented by dashboard query models.
7. Download the JSON document or publish it directly.

The app removes `id`, `uid`, and `version`, preserves the visualization model,
replaces DIL datasource instance UIDs with `${DIL_DATASOURCE}`, and records
Grafana/plugin requirements. Provider-created dashboards are data, not plugin
source, so sharing a new dashboard never requires rebuilding either plugin.

## Consumer workflow

1. Install and configure `dataspacelab-dil-datasource` against the consumer DIL
   dataplane, finalized agreement, active transfer, dataset, offer, and provider
   dashboard identifiers.
2. Receive the `GrafanaDashboard` JSON through the DIL Connector or as a file.
3. On that datasource's configuration page, select the JSON under **Import
   portable DIL dashboard JSON**.
4. The plugin validates the document type and plugin ID, maps
   `${DIL_DATASOURCE}` to that local datasource UID, clears provider dashboard
   identity fields, and calls Grafana's authenticated dashboard HTTP API with
   `overwrite: false`.
5. Open the imported dashboard. Its queries execute through the local DIL
   datasource and negotiated dataspace access.

The older **Import shared dashboard** button remains for manifest-based imports.

## Service accounts

No Grafana service account is created in this version. The provider action uses
the dashboard model already available to the authenticated Editor/Admin, and the
consumer import runs with the signed-in user's normal Grafana permissions.

If a future DIL Connector must retrieve dashboard definitions asynchronously,
use Grafana's managed app-plugin service account, grant only dashboard/folder
read access, and keep its credential distinct from the Connector publish token.
Any externally delegated token must be short-lived and revoked when its DIL
agreement ends. Never send either token to browser code or embed it in the
shared document.
