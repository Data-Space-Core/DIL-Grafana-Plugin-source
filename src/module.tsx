import React, { useState } from 'react';
import { DataSourcePlugin, DataQuery, DataSourceJsonData, DataSourceInstanceSettings, DataSourcePluginOptionsEditorProps, QueryEditorProps } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv } from '@grafana/runtime';
import { Button, Input, Field, SecretInput, Alert, Select, Checkbox } from '@grafana/ui';

interface Options extends DataSourceJsonData { connectorUrl: string; agreementId: string; datasetId: string; offerId: string; dashboardId: string; transferType?: string; allowHttp?: boolean }
interface Secrets { connectorToken?: string }
interface Query extends DataQuery { panelId: string; templateRef: string }
interface Manifest { title: string; dashboardId: string; panels: Array<{id: number; title: string; type: string; queries: Array<{refId: string; panelId: string}>}> }
interface SharedDashboard {
  type: string;
  title: string;
  dashboard: Record<string, unknown>;
  datasource: {pluginId: string; placeholder?: string};
  dil?: {agreementId?: string; datasetId?: string; offerId?: string; dashboardId?: string; transferType?: string; consumerDataplaneUrl?: string; allowHttp?: boolean};
  requires?: {grafana?: string; plugin?: {id?: string; version?: string}};
  integrity?: {algorithm?: string; dashboard?: string};
}
interface GrafanaDatasource { id?: number; uid?: string; name?: string; type?: string; access?: string; url?: string; jsonData?: Record<string, unknown>; secureJsonFields?: Record<string, boolean> }
type ImportSettings = {
  id?: number;
  uid?: string;
  jsonData: Options;
  secureJsonData?: Secrets;
  secureJsonFields?: Record<string, boolean>;
};

function importedDatasourceSettings(document: SharedDashboard, options: ImportSettings) {
  const metadata = document.dil || {};
  const connectorUrl = String(metadata.consumerDataplaneUrl || options.jsonData.connectorUrl || '').trim();
  if (!connectorUrl) { throw new Error('Set the consumer dataplane URL in the DIL datasource configuration first.'); }
  const agreementId = String(metadata.agreementId || options.jsonData.agreementId || '').trim();
  const datasetId = String(metadata.datasetId || options.jsonData.datasetId || '').trim();
  const offerId = String(metadata.offerId || options.jsonData.offerId || '').trim();
  const dashboardId = String(metadata.dashboardId || options.jsonData.dashboardId || '').trim();
  if (!agreementId || !datasetId || !offerId || !dashboardId) {
    throw new Error('The shared dashboard does not contain complete DIL transfer metadata.');
  }
  return {
    connectorUrl,
    agreementId,
    datasetId,
    offerId,
    dashboardId,
    transferType: metadata.transferType || options.jsonData.transferType || 'grafana-dashboard',
    allowHttp: metadata.allowHttp ?? Boolean(options.jsonData.allowHttp),
  };
}

async function findDatasource(name: string): Promise<GrafanaDatasource | undefined> {
  try {
    return await getBackendSrv().get<GrafanaDatasource>(`/api/datasources/name/${encodeURIComponent(name)}`);
  } catch (reason) {
    if ((reason as {status?: number})?.status === 404) { return undefined; }
    throw reason;
  }
}

async function ensureImportedDatasource(document: SharedDashboard, options: ImportSettings): Promise<string> {
  const jsonData = importedDatasourceSettings(document, options);
  const token = String(options.secureJsonData?.connectorToken || '').trim();
  let existing: GrafanaDatasource | undefined;
  if (options.uid) {
    existing = await getBackendSrv().get<GrafanaDatasource>(`/api/datasources/uid/${encodeURIComponent(options.uid)}`);
  } else {
    const suffix = jsonData.agreementId.slice(0, 8);
    existing = await findDatasource(`DIL: ${document.title} (${suffix})`);
  }
  if (existing?.type && existing.type !== 'dataspacelab-dil-datasource') {
    throw new Error('A datasource with the generated dashboard name already exists and has a different type.');
  }
  const hasExistingToken = Boolean(existing?.secureJsonFields?.connectorToken) || Boolean(options.secureJsonFields?.connectorToken);
  if (!token && !hasExistingToken) {
    throw new Error('Enter and save a consumer dataplane token before importing this dashboard.');
  }
  const name = existing?.name || `DIL: ${document.title} (${jsonData.agreementId.slice(0, 8)})`;
  const payload: Record<string, unknown> = {
    name,
    type: 'dataspacelab-dil-datasource',
    access: 'proxy',
    url: '',
    jsonData,
  };
  if (token) { payload.secureJsonData = {connectorToken: token}; }
  if (existing?.id !== undefined) { payload.id = existing.id; }
  if (existing?.uid) { payload.uid = existing.uid; }
  const saved = existing?.uid
    ? await getBackendSrv().put<GrafanaDatasource>(`/api/datasources/uid/${encodeURIComponent(existing.uid)}`, payload)
    : await getBackendSrv().post<GrafanaDatasource>('/api/datasources', payload);
  const uid = saved.uid || existing?.uid;
  if (!uid) { throw new Error('Grafana created the datasource without returning a UID.'); }
  return uid;
}
class DataSource extends DataSourceWithBackend<Query, Options> {
  constructor(settings: DataSourceInstanceSettings<Options>) { super(settings); }
}

function ConfigEditor({ options, onOptionsChange }: DataSourcePluginOptionsEditorProps<Options, Secrets>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const fields: Array<[keyof Options, string]> = [['connectorUrl', 'Consumer dataplane URL'], ['agreementId', 'Finalized agreement ID'], ['datasetId', 'Dataset ID'], ['offerId', 'Offer ID'], ['dashboardId', 'Provider dashboard UID']];
  const importDashboard = async () => {
    setBusy(true); setError(''); setImportUrl('');
    try {
      if (!options.uid) { throw new Error('Save this datasource before importing a dashboard.'); }
      const manifest = await getBackendSrv().get<Manifest>(`/api/datasources/uid/${encodeURIComponent(options.uid)}/resources/manifest`);
      const datasource = {type: 'dataspacelab-dil-datasource', uid: options.uid};
      const dashboard = {title: manifest.title, schemaVersion: 39, timezone: 'browser', refresh: '30s', time: {from: 'now-1h', to: 'now'}, tags: ['DIL'],
        panels: manifest.panels.map((panel, index) => ({id: panel.id, title: panel.title, type: panel.type, datasource,
          gridPos: {x: (index % 2) * 12, y: Math.floor(index / 2) * 8, w: 12, h: 8},
          targets: panel.queries.map(q => ({refId: q.refId, panelId: q.panelId, templateRef: q.refId, datasource}))}))};
      const saved = await getBackendSrv().post('/api/dashboards/db', {dashboard, overwrite: false, message: 'Imported through DIL finalized agreement'});
      setImportUrl(saved.url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Dashboard import failed; check the agreement and connector.'); }
    finally { setBusy(false); }
  };
  const importSharedDocument = async (file?: File) => {
    setBusy(true); setError(''); setImportUrl('');
    try {
      if (!file) { throw new Error('Select a DIL dashboard JSON file.'); }
      const document = JSON.parse(await file.text()) as SharedDashboard;
      if (document.type !== 'GrafanaDashboard' || document.datasource?.pluginId !== 'dataspacelab-dil-datasource' || !document.dashboard) {
        throw new Error('The selected file is not a DIL GrafanaDashboard document.');
      }
      const datasourceUid = await ensureImportedDatasource(document, options);
      if (document.integrity?.dashboard) {
        if (document.integrity.algorithm !== 'sha256') { throw new Error('The dashboard document uses an unsupported integrity algorithm.'); }
        const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object'
          ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, canonicalize((value as Record<string, unknown>)[key])])) : value;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalize(document.dashboard))));
        const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== document.integrity.dashboard.toLowerCase()) { throw new Error('The dashboard document failed its integrity check.'); }
      }
      const placeholder = document.datasource.placeholder || '${DIL_DATASOURCE}';
      const mapDatasource = (value: unknown): unknown => {
        if (Array.isArray(value)) { return value.map(mapDatasource); }
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, mapDatasource(child)]));
        }
        return value === placeholder ? datasourceUid : value;
      };
      const dashboard = mapDatasource(document.dashboard) as Record<string, unknown>;
      dashboard.id = null;
      delete dashboard.uid;
      delete dashboard.version;
      const saved = await getBackendSrv().post('/api/dashboards/db', {dashboard, overwrite: false, message: `Imported from DIL datasource ${datasourceUid}`});
      setImportUrl(saved.url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Shared dashboard import failed.'); }
    finally { setBusy(false); }
  };
  return <div style={{maxWidth: 720}}>
    {fields.map(([key, label]) => <Field label={label} key={String(key)}><Input value={String(options.jsonData[key] || '')} onChange={e => onOptionsChange({...options, jsonData: {...options.jsonData, [key]: e.currentTarget.value}})} /></Field>)}
    <Field label="Allow HTTP (internal/lab only)" description="Enable only for a trusted internal dataplane URL. HTTPS is required by default.">
      <Checkbox value={Boolean(options.jsonData.allowHttp)} onChange={event => onOptionsChange({...options, jsonData: {...options.jsonData, allowHttp: event.currentTarget.checked}})} />
    </Field>
    <Field label="Consumer dataplane token"><SecretInput value={options.secureJsonData?.connectorToken || ''} isConfigured={Boolean(options.secureJsonFields?.connectorToken)}
      onChange={e => onOptionsChange({...options, secureJsonData: {...options.secureJsonData, connectorToken: e.currentTarget.value}})}
      onReset={() => onOptionsChange({...options, secureJsonFields: {...options.secureJsonFields, connectorToken: false}, secureJsonData: {...options.secureJsonData, connectorToken: ''}})} /></Field>
    <Button icon="download-alt" onClick={importDashboard} disabled={busy}>{busy ? 'Importing...' : 'Import shared dashboard'}</Button>
    <Field label="Import portable DIL dashboard JSON" description="Maps portable references to this saved DIL datasource instance.">
      <Input type="file" accept="application/json,.json" disabled={busy} onChange={event => importSharedDocument(event.currentTarget.files?.[0])} />
    </Field>
    {error && <Alert title="Import failed" severity="error">{error}</Alert>}
    {importUrl && <p><a href={importUrl}>Open imported dashboard</a></p>}
  </div>;
}

function QueryEditor({datasource, query, onChange, onRunQuery}: QueryEditorProps<DataSource, Query, Options>) {
  const [manifest, setManifest] = useState<Manifest>();
  const [error, setError] = useState('');
  const panel = manifest?.panels.find(p => String(p.id) === query.panelId);
  return <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end'}}>
    <Button icon="sync" onClick={async () => {try {setManifest(await datasource.getResource('manifest'));setError('');} catch {setError('Shared dashboard is unavailable. Check the finalized agreement.');}}}>Load panels</Button>
    <Field label="Shared panel"><Select width={30} value={query.panelId} options={manifest?.panels.map(p => ({label: p.title, value: String(p.id)})) || [{label: query.panelId, value: query.panelId}]}
      onChange={v => onChange({...query, panelId: v.value || '', templateRef: ''})} /></Field>
    <Field label="Query template"><Select width={20} value={query.templateRef} options={panel?.queries.map(q => ({label: q.refId, value: q.refId})) || [{label: query.templateRef, value: query.templateRef}]}
      onChange={v => {onChange({...query, templateRef: v.value || ''});onRunQuery();}} /></Field>
    {error && <Alert title="DIL query" severity="error">{error}</Alert>}
  </div>;
}
export const plugin = new DataSourcePlugin<DataSource, Query, Options>(DataSource).setConfigEditor(ConfigEditor).setQueryEditor(QueryEditor);
