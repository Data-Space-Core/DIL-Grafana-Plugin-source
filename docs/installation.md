# Install into an existing Grafana

## Requirements

- Grafana **13.0.1 or newer**, self-managed OSS or Enterprise.
- Administrator access to install backend plugins and restart Grafana.
- Linux amd64/arm64, macOS amd64/arm64, or Windows amd64 server.
- A reachable DIL consumer dataplane with the Grafana adapter API, a FINALIZED
  agreement and a STARTED `grafana-query` transfer.

The plugin does not include or replace Grafana, the connector or the dataplane.
Grafana Cloud and other managed hosts may prohibit arbitrary private/unsigned
plugins; follow their approval process. Installation into a running instance
requires a restart to load the backend, not a hot-install.

## Install the ZIP

On a standard Linux package installation:

```bash
cd artifacts
sha256sum -c dataspacelab-dil-datasource-0.2.0.zip.sha256
sudo unzip dataspacelab-dil-datasource-0.2.0.zip -d /var/lib/grafana/plugins
sudo chown -R grafana:grafana /var/lib/grafana/plugins/dataspacelab-dil-datasource
sudo chmod 755 /var/lib/grafana/plugins/dataspacelab-dil-datasource/gpx_dil_*
```

Use the configured `paths.plugins` directory if different. The ZIP has a single
top-level directory named `dataspacelab-dil-datasource`, with plugin.json,
frontend assets and backend executables directly inside it. For upgrades, stop
Grafana and move the previous directory to a backup location **outside** its
plugin search path before extracting. Do not mix files from different releases.

Local builds are **unsigned**. For a trusted internal installation, add only
this plugin ID to the existing allowlist in `grafana.ini`:

```ini
[plugins]
allow_loading_unsigned_plugins = dataspacelab-dil-datasource
```

Preserve existing allowlisted IDs, then restart:

```bash
sudo systemctl restart grafana-server
```

On Windows/macOS, extract into the configured plugin directory and restart
Grafana. Preserve POSIX backend executable permissions. Checksums detect
corruption; they do not replace a trusted publisher or signature.

## Existing Docker or Kubernetes installation

No custom Grafana image is required. Mount the extracted directory into the
instance's plugin search path, for example:

```yaml
volumes:
  - ./dataspacelab-dil-datasource:/var/lib/grafana/plugins/dataspacelab-dil-datasource:ro
environment:
  GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: dataspacelab-dil-datasource
```

Alternatively, host the ZIP on a trusted HTTPS endpoint:

```text
GF_PLUGINS_PREINSTALL_SYNC=dataspacelab-dil-datasource@0.2.0@https://YOUR-RELEASE-HOST/dataspacelab-dil-datasource-0.2.0.zip
```

Replace the placeholder with the published artifact URL and append to any
existing preinstall list. Restart/recreate the container or roll out the pods.
Persist plugin files or retain installation configuration for future starts.
For signed distributions, remove this plugin from the unsigned allowlist.

## Configure the datasource

In Connections > Data sources, add **DIL Dataspace**:

- Consumer dataplane URL: HTTPS origin/base path before `/grafana/consumer`.
- Finalized agreement ID, dataset ID and offer ID, not negotiation PIDs.
- Provider dashboard UID from the shared dataset.
- Consumer dataplane token in the secure field.

Save & test checks the manifest through the backend. **Import shared dashboard**
creates a new local dashboard using the saved configuration; it never overwrites
one. Queries use approved panel/template references, not arbitrary PromQL.
Restrict datasource permissions: authorized Grafana users exercise its agreement.

Saved settings remain `connectorUrl` and secure `connectorToken` for
compatibility, but refer to the **consumer dataplane**. Credentials do not belong
in dashboard JSON. HTTP is disabled by default; `allowHttp: true` is lab-only.

Service setup is documented separately in
`DIL-Connector-source/Dataplane/GRAFANA-INTEGRATION.md`. Optional deployment and
synthetic test fixtures are in `DIL-Grafana-deployment`.

## Signing and publishing

Publish the ZIP/checksum as release artifacts. A local build does not publish
anything or claim a Grafana signature.

To sign, build the complete `dist` directory including all backends, then sign
it using Grafana's signing tool, then run the packager. It preserves MANIFEST.txt.
Do not modify signed files afterward. Private signatures restrict installation
to declared root URLs; broad distribution requires Grafana public signing/review.

- [Packaging](https://grafana.com/developers/plugin-tools/publish-a-plugin/package-a-plugin)
- [Signing](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin)
- [Docker installation](https://grafana.com/docs/grafana/latest/setup-grafana/installation/docker/)
