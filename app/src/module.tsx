import React, { useState } from 'react';
import { AppPlugin, AppRootProps, PluginExtensionPanelContext, PluginExtensionPoints } from '@grafana/data';
import { getBackendSrv, PluginPage } from '@grafana/runtime';
import { Alert, Button, Field, Input, SecretInput } from '@grafana/ui';

const APP_ID = 'dataspacelab-dil-dashboard-app';

interface AppConfig {
  connectorEndpoint?: string;
  allowHttp?: boolean;
}

interface SharedDocument {
  type: 'GrafanaDashboardReference';
  title: string;
  dataAddress: {type: 'GrafanaDashboard'; dashboardId: string};
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

function currentDashboardUid(dashboard: Record<string, unknown>): string {
  const fromContext = typeof dashboard.uid === 'string' ? dashboard.uid : '';
  if (fromContext) { return fromContext; }
  const match = window.location.pathname.match(/^\/d\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function ShareDialog({dashboard, dashboardUid, onDismiss}: {dashboard: Record<string, unknown>; dashboardUid: string; onDismiss?: () => void}) {
  const [busy, setBusy] = useState<'export' | 'publish'>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (operation: 'export' | 'publish') => {
    setBusy(operation); setMessage(''); setError('');
    try {
      // Panel-menu extension context contains dashboard metadata only. Fetch the
      // complete dashboard through Grafana's authenticated API before sharing.
      const full = await getBackendSrv().get<{dashboard?: Record<string, unknown>}>(
        `/api/dashboards/uid/${encodeURIComponent(dashboardUid)}`
      );
      if (!full.dashboard || full.dashboard.uid !== dashboardUid) {
        throw new Error('Grafana returned no complete dashboard definition.');
      }
      const document = await getBackendSrv().post<SharedDocument | {status: string}>(
        `/api/plugins/${APP_ID}/resources/${operation}`,
        {dashboard: {uid: full.dashboard.uid, title: full.dashboard.title}}
      );
      if (operation === 'export') {
        download(document as SharedDocument);
        setMessage('Dashboard reference downloaded.');
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
    <Field label="Dashboard UID"><Input value={dashboardUid} readOnly /></Field>
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
    return <PluginPage subTitle="Dashboard references for DIL data sources">
      <p>Open a dashboard panel menu and choose <strong>Share dashboard via DIL</strong>. The action shares a reference to the whole saved dashboard.</p>
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
      <Field label="DIL Connector dashboard publish endpoint" description="Exact HTTPS REST endpoint that accepts a GrafanaDashboardReference document.">
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
    description: 'Export or publish this dashboard as a DIL dashboard reference',
    targets: [PluginExtensionPoints.DashboardPanelMenu],
    icon: 'share-alt',
    onClick: (_event, helpers) => {
      const dashboard = helpers.context?.dashboard as unknown as Record<string, unknown> | undefined;
      const dashboardUid = dashboard ? currentDashboardUid(dashboard) : '';
      if (!dashboard || !dashboardUid) { return; }
      helpers.openModal({
        title: 'Share dashboard via DIL',
        width: 760,
        body: ({onDismiss}) => <ShareDialog dashboard={dashboard} dashboardUid={dashboardUid} onDismiss={onDismiss} />,
      });
    },
  });
