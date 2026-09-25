import React, { useState } from 'react';
import { AppPlugin, AppRootProps, PluginExtensionPanelContext, PluginExtensionPoints } from '@grafana/data';
import { getBackendSrv, PluginPage } from '@grafana/runtime';
import { Alert, Button, Field, Input, SecretInput, TextArea } from '@grafana/ui';

const APP_ID = 'dataspacelab-dil-dashboard-app';

interface AppConfig {
  connectorEndpoint?: string;
  allowHttp?: boolean;
}

interface SharedDocument {
  type: 'GrafanaDashboard';
  title: string;
  dashboard: Record<string, unknown>;
  datasource: {pluginId: string; placeholder: string};
  assets: string[];
  requires: Record<string, unknown>;
  integrity: Record<string, unknown>;
}

function download(document: SharedDocument) {
  const blob = new Blob([JSON.stringify(document, null, 2)], {type: 'application/json'});
  const href = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = href;
  anchor.download = `${document.title.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}-dil-dashboard.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function ShareDialog({dashboard, onDismiss}: {dashboard: Record<string, unknown>; onDismiss?: () => void}) {
  const [assets, setAssets] = useState('');
  const [busy, setBusy] = useState<'export' | 'publish'>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (operation: 'export' | 'publish') => {
    setBusy(operation); setMessage(''); setError('');
    try {
      const document = await getBackendSrv().post<SharedDocument | {status: string}>(
        `/api/plugins/${APP_ID}/resources/${operation}`,
        {dashboard, assets: assets.split(/[\n,]/).map(v => v.trim()).filter(Boolean)}
      );
      if (operation === 'export') {
        download(document as SharedDocument);
        setMessage('Portable dashboard document downloaded.');
      } else {
        setMessage('Dashboard published to the configured DIL Connector endpoint.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Dashboard ${operation} failed.`);
    } finally {
      setBusy(undefined);
    }
  };

  return <div style={{width: 'min(680px, 80vw)'}}>
    <p>The complete current dashboard will be exported. DIL datasource references are replaced with a portable placeholder.</p>
    <Field label="DIL asset IDs" description="Optional comma- or line-separated asset URNs. Asset IDs present in dashboard query models are detected automatically.">
      <TextArea rows={4} value={assets} onChange={event => setAssets(event.currentTarget.value)} placeholder="urn:dil:asset:..." />
    </Field>
    {error && <Alert title="DIL dashboard sharing failed" severity="error">{error}</Alert>}
    {message && <Alert title="DIL dashboard sharing" severity="success">{message}</Alert>}
    <div style={{display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16}}>
      <Button variant="secondary" onClick={onDismiss}>Close</Button>
      <Button icon="download-alt" disabled={Boolean(busy)} onClick={() => run('export')}>{busy === 'export' ? 'Exporting...' : 'Download JSON'}</Button>
      <Button icon="upload" disabled={Boolean(busy)} onClick={() => run('publish')}>{busy === 'publish' ? 'Publishing...' : 'Publish to DIL'}</Button>
    </div>
  </div>;
}

function Root({meta}: AppRootProps<AppConfig>) {
  const config = meta.jsonData || {};
  const [endpoint, setEndpoint] = useState(config.connectorEndpoint || '');
  const [token, setToken] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(Boolean(meta.secureJsonFields?.connectorToken));
  const [tokenDirty, setTokenDirty] = useState(false);
  const [allowHttp, setAllowHttp] = useState(Boolean(config.allowHttp));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const isConfig = window.location.pathname.endsWith('/config');

  if (!isConfig) {
    return <PluginPage subTitle="Portable dashboard definitions for negotiated DIL data access">
      <p>Open a dashboard panel menu and choose <strong>Share dashboard via DIL</strong>. The action exports the entire dashboard, not only that panel.</p>
      <p>Provider-created dashboards stay independent of plugin releases. Consumer Grafana instances import the document and map its datasource placeholder to their local DIL datasource.</p>
      <Button icon="cog" onClick={() => window.location.assign(`/a/${APP_ID}/config`)}>Configure DIL endpoint</Button>
    </PluginPage>;
  }

  const save = async () => {
    setSaved(false); setError('');
    try {
      await getBackendSrv().post(`/api/plugins/${APP_ID}/settings`, {
        enabled: true,
        jsonData: {connectorEndpoint: endpoint.trim(), allowHttp},
        ...(tokenDirty ? {secureJsonData: {connectorToken: token}} : {}),
      });
      setTokenConfigured(Boolean(token) || (tokenConfigured && !tokenDirty));
      setToken(''); setTokenDirty(false); setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Configuration could not be saved.');
    }
  };

  return <PluginPage subTitle="Provider publishing configuration">
    <div style={{maxWidth: 720}}>
      <Field label="DIL Connector dashboard publish endpoint" description="Exact HTTPS REST endpoint that accepts a GrafanaDashboard document.">
        <Input value={endpoint} onChange={event => setEndpoint(event.currentTarget.value)} placeholder="https://connector.example/api/..." />
      </Field>
      <Field label="DIL Connector publish token" description="Stored encrypted by Grafana and used only by the app backend.">
        <SecretInput value={token} isConfigured={tokenConfigured}
          onChange={event => { setToken(event.currentTarget.value); setTokenDirty(true); }}
          onReset={() => { setToken(''); setTokenConfigured(false); setTokenDirty(true); }} />
      </Field>
      <label style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16}}>
        <input type="checkbox" checked={allowHttp} onChange={event => setAllowHttp(event.currentTarget.checked)} />
        Allow plain HTTP for local development only
      </label>
      {error && <Alert title="Configuration failed" severity="error">{error}</Alert>}
      {saved && <Alert title="Configuration saved" severity="success">The app backend will use the updated settings.</Alert>}
      <Button icon="save" onClick={save}>Save configuration</Button>
    </div>
  </PluginPage>;
}

export const plugin = new AppPlugin<AppConfig>()
  .setRootPage(Root)
  .addLink<PluginExtensionPanelContext>({
    title: 'Share dashboard via DIL',
    description: 'Export or publish this dashboard as a portable DIL document',
    targets: [PluginExtensionPoints.DashboardPanelMenu],
    icon: 'share-alt',
    onClick: (_event, helpers) => {
      const dashboard = helpers.context?.dashboard as unknown as Record<string, unknown> | undefined;
      if (!dashboard) { return; }
      helpers.openModal({
        title: 'Share dashboard via DIL',
        width: 760,
        body: ({onDismiss}) => <ShareDialog dashboard={dashboard} onDismiss={onDismiss} />,
      });
    },
  });
