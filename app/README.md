# DIL Dashboard Sharing app

Provider companion for `dataspacelab-dil-datasource`. Enable it in Grafana,
configure the DIL Connector publish endpoint, then use **Share dashboard via
DIL** from any panel menu. The action always exports the complete dashboard.

The backend removes instance IDs, replaces DIL datasource references with the
portable `${DIL_DATASOURCE}` placeholder, discovers DIL asset URNs in query
models, and can either return the document or publish it to the configured
connector endpoint. Connector credentials are encrypted app settings and are
never returned to the browser.

This version does not need a Grafana service account: the action receives the
dashboard model that the authenticated Editor/Admin is already permitted to
view. Anonymous access remains disabled. If a future retrieval flow reads
dashboards independently of a signed-in user, use Grafana's managed plugin
service account with dashboard/folder read scope instead of reusing the DIL
Connector credential.
