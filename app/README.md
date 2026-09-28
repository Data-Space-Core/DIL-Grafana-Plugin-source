# DIL Dashboard Sharing app

Provider companion for `dataspacelab-dil-datasource`. Enable it in Grafana,
configure the DIL Connector publish endpoint, then use **Share dashboard via
DIL** from any panel menu. The action always exports the complete dashboard.

The panel-menu extension receives dashboard metadata from Grafana. Before
sharing, the frontend fetches the complete dashboard definition from
Grafana's authenticated `/api/dashboards/uid/{uid}` endpoint. The backend
then removes instance IDs, replaces DIL datasource references with the
portable `${DIL_DATASOURCE}` placeholder, discovers DIL asset URNs in query
models, and can either return the document or publish it to the configured
connector endpoint. Connector credentials are encrypted app settings and are
never returned to the browser.

The `integrity.dashboard` value in the exported JSON is a SHA-256 checksum; it
is not the Grafana dashboard UID. Configure the data source or Grafana offer
with the actual UID from the dashboard URL (`/d/<uid>/...`).

This version does not need a Grafana service account: the action receives the
dashboard model that the authenticated Editor/Admin is already permitted to
view. Anonymous access remains disabled. If a future retrieval flow reads
dashboards independently of a signed-in user, use Grafana's managed plugin
service account with dashboard/folder read scope instead of reusing the DIL
Connector credential.
