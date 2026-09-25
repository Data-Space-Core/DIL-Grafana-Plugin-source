# DIL Grafana datasource plugin

Standalone DIL Grafana plugins for **Grafana 13.0.1 and newer**.
Install it into an existing Grafana; no replacement Grafana image is needed.
This repository contains only plugin code, tests, build tooling and plugin docs.
Connector/dataplane services and deployment manifests live in separate projects.

## Build a distributable plugin

Docker with BuildKit is sufficient; host Node/Go installations are not required:

```bash
cd /home/vmuser/DIL-Grafana-Plugin-source
docker build --output type=local,dest=artifacts .
```

Outputs:

- `artifacts/dataspacelab-dil-datasource-0.3.0.zip`
- `artifacts/dataspacelab-dil-dashboard-app-0.1.0.zip`
- a `.sha256` file and extracted installable directory for each plugin
- `artifacts/dataspacelab-dil-datasource/`: extracted installable plugin

Each ZIP includes its frontend and Go backends for Linux amd64/arm64,
macOS amd64/arm64 and Windows amd64. Grafana selects its server's executable.
The Dockerfile is a build/export pipeline, **not a runnable Grafana image**.
Do not use `docker push` to distribute this plugin: publish the ZIP/checksum.

For a native build with Node 22, Go 1.25 and Python 3.11+:

```bash
npm ci
npm run typecheck
npm run build
go test -mod=readonly ./pkg/... ./app/pkg/...
sh scripts/build-backend.sh
python3 scripts/package-plugin.py
python3 -m unittest discover -s scripts -p 'test_*.py'
```

Build the frontend before the backend: webpack cleans `dist`. Dependencies are
locked by `package-lock.json` and `go.sum`.

## Install and configure

See [installation instructions](docs/installation.md) for ZIP installation,
Docker/Kubernetes mounting, signatures, restart and datasource configuration.
Unsigned builds need an explicit plugin-ID allowlist on a self-managed instance.
Managed Grafana services may require approval.

The datasource plugin provides QueryData, CheckHealth, a restricted manifest resource
handler, panel/template selectors and dashboard import. It communicates only
with the configured consumer dataplane. A finalized agreement and active
`grafana-query` transfer must already exist; it does not negotiate contracts.

Supported shared visualizations: timeseries, table, stat, gauge and bargauge.
Provider queries currently use approved Prometheus templates. Variables/macros,
streaming, alerts, annotations and arbitrary query editors are not implemented.
Provider credentials and query text remain in the provider dataplane/Grafana.

The companion `dataspacelab-dil-dashboard-app` adds the supported Grafana panel
menu action **Share dashboard via DIL**, backend export/publish resources, and
encrypted Connector endpoint credentials. See
[dashboard sharing](docs/dashboard-sharing.md) for provider and consumer flows.

## Compatibility and tests

The plugin declares `grafanaDependency: >=13.0.1` and builds against the 13.0.1
Grafana packages. React and its JSX runtime are supplied by Grafana, not bundled.
This follows [Grafana's migration guidance](https://grafana.com/developers/plugin-tools/migration-guides/update-from-grafana-versions/migrate-12_x-to-13_x).
Future breaking Grafana releases still require regression testing; a minimum
version declaration cannot guarantee compatibility with every future release.

The build runs TypeScript checks, Go tests and ZIP-layout/permissions tests.
Integration/browser fixtures are in `DIL-Grafana-deployment/dev`, outside this
source. That deployment runs an unmodified Grafana image with this plugin
mounted. Its synthetic data is not a cross-connector DCP test.
