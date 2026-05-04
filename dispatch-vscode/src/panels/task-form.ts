import * as vscode from 'vscode';
import { DispatchClient } from '../client';

export async function showTaskForm(client: DispatchClient, taskId?: string, onSaved?: () => void | Promise<void>) {
  const [agents, teams, models, task] = await Promise.all([
    client.get<any[]>('/api/agents'),
    client.get<any[]>('/api/teams'),
    client.get<any>('/api/models'),
    taskId ? client.get<any>(`/api/tasks/${encodeURIComponent(taskId)}`) : Promise.resolve(undefined),
  ]);

  if (task?.status === 'running') {
    vscode.window.showWarningMessage('Running tasks cannot be edited.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'dispatchTaskForm',
    task ? `Edit Task: ${task.id.slice(-8)}` : 'Create Task',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command !== 'save') return;
    try {
      if (msg.task.assignmentType === 'team' && !msg.task.teamId) {
        throw new Error('Select a team before saving a team-assigned task.');
      }
      const body = {
        title: msg.task.title,
        description: msg.task.description,
        agent: msg.task.assignmentType === 'agent' ? msg.task.agent : undefined,
        teamId: msg.task.assignmentType === 'team' ? msg.task.teamId : undefined,
        priority: msg.task.priority,
        model: msg.task.model || undefined,
        repo: msg.task.repo || undefined,
        workingDirectory: msg.task.workingDirectory || undefined,
        maxRetries: Number(msg.task.maxRetries ?? 3),
        metadata: msg.task.assignmentType === 'team'
          ? { preApproved: msg.task.preApproved === true }
          : { preApproved: msg.task.preApproved === true, teamId: null, teamName: null, teamRole: null, teamLeadTaskId: null, memberAgents: null },
      };
      if (msg.task.dryRun === true && !task) {
        const preview: any = await client.post('/api/tasks/preview', body);
        await panel.webview.postMessage({ command: 'preview', preview });
        return;
      }
      const saved: any = task
        ? await client.put(`/api/tasks/${encodeURIComponent(task.id)}`, body)
        : await client.post('/api/tasks', { ...body, createdBy: 'vscode' });
      const savedId = saved.leadTask?.id ?? saved.id;
      const memberCount = saved.memberTasks?.length ?? 0;
      vscode.window.showInformationMessage(task
        ? `Task ${savedId} updated${memberCount ? ` with ${memberCount} team member task(s)` : ''}`
        : `Task ${savedId} created${memberCount ? ` with ${memberCount} team member task(s)` : ''}`);
      await onSaved?.();
      panel.dispose();
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message);
      await panel.webview.postMessage({ command: 'error', message: err.message });
    }
  });

  const options = {
    agents: agents.map(a => a.name),
    teams: teams.map(team => ({ id: team.id, name: team.name, leadAgent: team.leadAgent, members: team.memberAgents?.length ?? 0 })),
    models: [''].concat((models.available ?? []).map((m: any) => m.id)),
    priorities: ['normal', 'low', 'high', 'critical'],
    task: task ?? {
      title: '',
      description: '',
      agent: '@general-purpose',
      priority: 'normal',
      repo: '',
      workingDirectory: '',
      maxRetries: 3,
      metadata: { preApproved: false },
    },
  };
  const model = task?.metadata?.model ?? '';
  const assignmentType = task?.metadata?.teamId ? 'team' : 'agent';
  const selectedTeamId = task?.metadata?.teamId ?? '';

  panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body{font-family:var(--vscode-font-family);background:var(--vscode-editor-background);color:var(--vscode-foreground);padding:18px;line-height:1.4}
label{display:block;margin:10px 0 4px;font-size:12px;color:var(--vscode-descriptionForeground)}
input,textarea,select{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:7px;border-radius:3px}
textarea{min-height:120px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.actions{margin-top:16px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;border-radius:4px;padding:8px 14px;cursor:pointer}.error{color:var(--vscode-errorForeground)}
.preview{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:12px;margin-top:12px;font-family:var(--vscode-editor-font-family);font-size:12px;white-space:pre-wrap}
.preview h3{margin:0 0 8px;font-size:13px}
.checks{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px}
.checks label{margin:0}
</style></head><body>
<h1>${task ? 'Edit Task' : 'Create Task'}</h1>
<div id="err" class="error"></div>
<div id="preview" class="preview" style="display:none"></div>
<label>Title</label><input id="title">
<label>Description</label><textarea id="description"></textarea>
<div class="row"><div><label>Assign to</label><select id="assignmentType" onchange="toggleAssignment()"><option value="agent">Agent</option><option value="team">Team</option></select></div><div><label>Priority</label><select id="priority"></select></div></div>
<div id="agentRow"><label>Agent</label><select id="agent"></select></div>
<div id="teamRow"><label>Team</label><select id="teamId"></select></div>
<div class="row"><div><label>Model override</label><select id="model"></select></div><div><label>Max retries</label><input id="maxRetries" type="number" min="0" max="10"></div></div>
<label>Repository path</label><input id="repo" placeholder="C:\\\\path\\\\to\\\\repo or owner/repo">
<label>Working directory</label><input id="workingDirectory" placeholder="C:\\\\path\\\\to\\\\working-directory">
<div class="checks">
  <label><input id="preApproved" type="checkbox" style="width:auto"> Pre-approved for execution</label>
  ${task ? '' : '<label><input id="dryRun" type="checkbox" style="width:auto"> Dry run (preview only)</label>'}
</div>
<div class="actions"><button onclick="save()">${task ? 'Save' : 'Create'}</button></div>
<script>
const vscode=acquireVsCodeApi();
const data=${JSON.stringify({ ...options, model, assignmentType, selectedTeamId })};
function esc(v){return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}
function setOptions(id, values, current){const el=document.getElementById(id); el.innerHTML=values.map(v=>'<option value="'+esc(v)+'">'+esc(v||'Default')+'</option>').join(''); el.value=current ?? '';}
function setTeamOptions(current){const el=document.getElementById('teamId'); el.innerHTML=data.teams.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+' ('+esc(t.leadAgent)+', '+t.members+' members)</option>').join(''); el.value=current ?? '';}
function toggleAssignment(){const useTeam=assignmentType.value==='team'; agentRow.style.display=useTeam?'none':'block'; teamRow.style.display=useTeam?'block':'none';}
document.getElementById('title').value=data.task.title||'';
document.getElementById('description').value=data.task.description||'';
document.getElementById('assignmentType').value=data.assignmentType;
setOptions('agent', data.agents, data.task.agent || '@general-purpose');
setTeamOptions(data.selectedTeamId);
setOptions('priority', data.priorities, data.task.priority || 'normal');
setOptions('model', data.models, data.model || '');
toggleAssignment();
document.getElementById('repo').value=data.task.repo||'';
document.getElementById('workingDirectory').value=data.task.workingDirectory||'';
document.getElementById('maxRetries').value=data.task.maxRetries ?? 3;
document.getElementById('preApproved').checked=data.task.metadata?.preApproved === true || data.task.metadata?.preApproved === 'true';
function save(){
  const dryEl=document.getElementById('dryRun');
  vscode.postMessage({command:'save',task:{title:title.value,description:description.value,assignmentType:assignmentType.value,agent:agent.value,teamId:teamId.value,priority:priority.value,model:model.value,repo:repo.value,workingDirectory:workingDirectory.value,maxRetries:maxRetries.value,preApproved:preApproved.checked,dryRun:dryEl ? dryEl.checked : false}});
}
window.addEventListener('message',e=>{
  if(e.data.command==='error'){document.getElementById('err').textContent=e.data.message;document.getElementById('preview').style.display='none';}
  if(e.data.command==='preview'){
    const p=e.data.preview, lines=[];
    lines.push('Title: '+(p.title||'(none)'));
    lines.push('Description: '+(p.description||'(none)'));
    lines.push('Agent: '+p.requestedAgent+(p.requestedAgent!==p.resolvedAgent?' → '+p.resolvedAgent:''));
    lines.push('Priority: '+p.priority);
    lines.push('Model: '+(p.requestedModel?p.requestedModel+' → '+p.resolvedModel:p.resolvedModel));
    lines.push('Repo: '+(p.repo||'(none)'));
    lines.push('Working directory: '+(p.workingDirectory||'(none)'));
    lines.push('Pre-approved: '+(p.preApproved?'yes':'no'));
    if(p.teamId) lines.push('Team: '+p.teamId);
    const notes=(p.notes||[]).map(n=>'• '+n).join('\\n');
    const el=document.getElementById('preview');
    el.innerHTML='<h3>Dry run — task would be created with:</h3>'+esc(lines.join('\\n'))+(notes?'\\n\\n'+esc(notes):'');
    el.style.display='block';
    document.getElementById('err').textContent='';
  }
});
</script></body></html>`;
}
