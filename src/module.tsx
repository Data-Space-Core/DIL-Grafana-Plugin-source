import React, { useState } from 'react';
import { DataSourcePlugin, DataQuery, DataSourceJsonData, DataSourceInstanceSettings, DataSourcePluginOptionsEditorProps, QueryEditorProps } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv } from '@grafana/runtime';
import { Button, Input, Field, SecretInput, Alert, Select } from '@grafana/ui';

interface Options extends DataSourceJsonData { connectorUrl: string; agreementId: string; datasetId: string; offerId: string; dashboardId: string; allowHttp?: boolean }
interface Secrets { connectorToken?: string }
interface Query extends DataQuery { panelId: string; templateRef: string }
interface Manifest { title: string; dashboardId: string; panels: Array<{id: number; title: string; type: string; queries: Array<{refId: string; panelId: string}>}> }
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
  return <div style={{maxWidth: 720}}>
    {fields.map(([key, label]) => <Field label={label} key={String(key)}><Input value={String(options.jsonData[key] || '')} onChange={e => onOptionsChange({...options, jsonData: {...options.jsonData, [key]: e.currentTarget.value}})} /></Field>)}
    <Field label="Consumer dataplane token"><SecretInput value={options.secureJsonData?.connectorToken || ''} isConfigured={Boolean(options.secureJsonFields?.connectorToken)}
      onChange={e => onOptionsChange({...options, secureJsonData: {...options.secureJsonData, connectorToken: e.currentTarget.value}})}
      onReset={() => onOptionsChange({...options, secureJsonFields: {...options.secureJsonFields, connectorToken: false}, secureJsonData: {...options.secureJsonData, connectorToken: ''}})} /></Field>
    <Button icon="download-alt" onClick={importDashboard} disabled={busy}>{busy ? 'Importing...' : 'Import shared dashboard'}</Button>
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
