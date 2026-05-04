import * as vscode from 'vscode';
import { DispatchClient } from '../client';
import type { DispatchFeature } from '../providers/feature-tree';

interface DispatchFeatureCategory {
  id: string;
  title: string;
  description: string;
}

interface DispatchFeatureCatalog {
  generatedAt: string;
  categories: DispatchFeatureCategory[];
  features: DispatchFeature[];
}

type FeatureActionHandler = (actionId: string) => Promise<void>;

let featurePanel: vscode.WebviewPanel | undefined;
let selectedFeatureId: string | undefined;
let activeClient: DispatchClient | undefined;
let activeActionHandler: FeatureActionHandler | undefined;

export function showFeatureDetail(client: DispatchClient, actionHandler: FeatureActionHandler, featureId?: string) {
  selectedFeatureId = featureId;
  activeClient = client;
  activeActionHandler = actionHandler;

  if (featurePanel) {
    featurePanel.reveal(vscode.ViewColumn.One);
    void loadFeatureCatalog();
    return;
  }

  featurePanel = vscode.window.createWebviewPanel(
    'dispatchFeatureDetail',
    featureId ? `Feature: ${featureId}` : 'Dispatch Features',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  featurePanel.onDidDispose(() => {
    featurePanel = undefined;
    selectedFeatureId = undefined;
  });

  featurePanel.webview.onDidReceiveMessage(async (msg) => {
    try {
      if (msg.command === 'load') {
        await loadFeatureCatalog();
        return;
      }
      if (msg.command === 'action' && msg.actionId) {
        await activeActionHandler?.(msg.actionId);
        await loadFeatureCatalog();
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message);
      await featurePanel?.webview.postMessage({ command: 'error', message: err.message });
    }
  });

  featurePanel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:18px;margin:0;line-height:1.45}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}.muted{color:var(--vscode-descriptionForeground);font-size:12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);border-radius:6px;padding:12px}
  .card h3{margin:0 0 6px;font-size:14px}.status{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:8px}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:7px 12px;margin:0 8px 8px 0;cursor:pointer}
  button:hover{background:var(--vscode-button-hoverBackground)}.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
  ul{padding-left:20px}.endpoint{font-family:var(--vscode-editor-font-family);font-size:12px;border-bottom:1px solid var(--vscode-input-border);padding:6px 0}
  .method{display:inline-block;width:48px;font-weight:700}.error{color:var(--vscode-errorForeground)}
</style></head><body>
<div id="c">Loading...</div>
<script>
const vsc=acquireVsCodeApi();
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}
function action(id){vsc.postMessage({command:'action',actionId:id})}
function renderFeature(feature){
  return '<h1>'+esc(feature.title)+'</h1>'+
    '<div class="muted">'+esc(feature.summary)+'</div>'+
    '<p>'+esc(feature.details)+'</p>'+
    '<div class="card"><h3>Current state</h3><div>'+esc(feature.status||'Available')+'</div></div>'+
    '<h2>Use or configure</h2><div>'+feature.actions.map(a=>'<button onclick="action(\\''+esc(a.id)+'\\')" title="'+esc(a.description)+'">'+esc(a.label)+'</button>').join('')+'</div>'+
    '<h2>Configuration points</h2><ul>'+feature.configuration.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>'+
    '<h2>API surface</h2>'+feature.endpoints.map(e=>'<div class="endpoint"><span class="method">'+esc(e.method)+'</span> '+esc(e.path)+' - '+esc(e.description)+'</div>').join('');
}
function renderCatalog(catalog){
  const byCat = new Map(catalog.categories.map(c=>[c.id,c]));
  return '<h1>Dispatch Features</h1><div class="muted">Generated '+esc(new Date(catalog.generatedAt).toLocaleString())+'</div>'+
    '<p>This catalog shows what Dispatch can do and gives you launch points for configuration and use.</p>'+
    catalog.categories.map(cat=>{
      const features=catalog.features.filter(f=>f.category===cat.id);
      return '<h2>'+esc(cat.title)+'</h2><div class="muted">'+esc(cat.description)+'</div><div class="grid">'+
        features.map(f=>'<div class="card"><h3>'+esc(f.title)+'</h3><div>'+esc(f.summary)+'</div><div class="status">'+esc(f.status)+'</div><p>'+f.actions.map(a=>'<button class="secondary" onclick="action(\\''+esc(a.id)+'\\')">'+esc(a.label)+'</button>').join('')+'</p></div>').join('')+
        '</div>';
    }).join('');
}
window.addEventListener('message', event => {
  if(event.data.command==='data'){
    const catalog=event.data.catalog;
    const featureId=event.data.featureId;
    const feature=featureId ? catalog.features.find(f=>f.id===featureId) : undefined;
    document.getElementById('c').innerHTML=feature ? renderFeature(feature) : renderCatalog(catalog);
  }
  if(event.data.command==='error') document.getElementById('c').innerHTML='<div class="error">Error: '+esc(event.data.message)+'</div>';
});
vsc.postMessage({command:'load'});
</script></body></html>`;
}

async function loadFeatureCatalog() {
  if (!featurePanel || !activeClient) return;
  const catalog: DispatchFeatureCatalog = await activeClient.get('/api/features');
  featurePanel.title = selectedFeatureId
    ? `Feature: ${catalog.features.find(feature => feature.id === selectedFeatureId)?.title ?? selectedFeatureId}`
    : 'Dispatch Features';
  await featurePanel.webview.postMessage({ command: 'data', catalog, featureId: selectedFeatureId });
}
