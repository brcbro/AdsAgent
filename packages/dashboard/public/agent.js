/* Persistent chat and queue controls for the local video agent. */
(() => {
  let state = { sessions: [], jobs: [] }, sessionId = localStorage.getItem("agentSessionId"), snapshot = "", sending = false;
  const edits = new Map();
  let connectionError = false;
  const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  async function request(url, body) {
    const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Agent request failed"); return data;
  }
  function notice(text) { document.getElementById("agentNotice").textContent = text; }
  function setSession(id) { sessionId = id; localStorage.setItem("agentSessionId", id); snapshot = ""; draw(); }
  function draw() {
    const serial = JSON.stringify([state, sessionId]); if (serial === snapshot) return; snapshot = serial;
    const selector = document.getElementById("agentSession");
    selector.innerHTML = state.sessions.map(s => `<option value="${escape(s.id)}">${escape(s.title)}</option>`).join(""); selector.value = sessionId;
    const session = state.sessions.find(s => s.id === sessionId);
    document.getElementById("agentMessages").innerHTML = session?.messages.length ? session.messages.map(m => `<div class="agent-message ${m.role}"><strong>${m.role === "user" ? "You" : "Video Agent"}</strong><div>${escape(m.text)}</div></div>`).join("")
      : '<div class="agent-welcome"><h2>Your German video assistant</h2><p>Describe the audience, topic, tone and call to action. I’ll write the script, create German narration, select B-roll and check the finished video.</p><p>Example: “Create a twenty-second German video about disciplined trading. Keep it calm and educational. End with an invitation to learn more.”</p></div>';
    const messages = document.getElementById("agentMessages"); messages.scrollTop = messages.scrollHeight;
    const jobs = state.jobs.filter(j => j.sessionId === sessionId);
    const busy = jobs.some(j => ["queued", "running"].includes(j.status));
    document.getElementById("agentRun").disabled = busy || sending;
    document.getElementById("agentWorker").textContent = state.workerRunning ? "Worker online · queue saved" : "Worker restarting · queue saved";
    const queueCards = [...state.jobs].sort((a, b) => Number(b.sessionId === sessionId) - Number(a.sessionId === sessionId));
    document.getElementById("agentJobs").innerHTML = queueCards.slice(0, 30).map(job => {
      const active = ["queued", "running", "script_review"].includes(job.status);
      const hasVideo = !!job.quality || job.stage === "quality";
      return `<article class="agent-job ${job.sessionId === sessionId ? "current-chat" : ""}">
        <div class="agent-job-head"><strong>${escape(job.title || job.brief.slice(0, 70))}</strong><span class="agent-badge ${escape(job.status)}">${escape(job.status.replace(/_/g, " "))}</span>${job.approvedAt ? `<span class="agent-badge approved">Approved</span>` : ""}</div>
        <p>${escape(job.stage)} · target ${job.targetSeconds}s · attempt ${job.attempts}/3</p>
        ${job.error ? `<p class="agent-error">${escape(job.error)}</p>` : ""}
        ${job.visualPlan?.length ? `<details><summary>Visual plan</summary><p>${job.visualPlan.map(escape).join("<br>")}</p></details>` : ""}
        ${job.scriptDe ? `<details ${job.status === "script_review" ? "open" : ""}><summary>German script</summary><textarea aria-label="German script for ${escape(job.title || 'video')}" data-script="${escape(job.id)}" rows="6" ${job.status !== "script_review" ? "readonly" : ""}>${escape(edits.get(job.id) ?? job.scriptDe)}</textarea>${job.status === "script_review" ? `<button class="header-button" data-job-action="approve" data-job="${escape(job.id)}">Create Video From Script</button>` : ""}</details>` : ""}
        ${job.quality ? `<details ${job.sessionId === sessionId ? "open" : ""}><summary>Technical quality report · ${job.quality.passed ? "passed" : "needs review"}</summary><ul class="agent-checks">${job.quality.checks.map(c => `<li class="${escape(c.result)}"><strong>${escape(c.result.toUpperCase())} · ${escape(c.name)}</strong><br>${escape(c.detail)}</li>`).join("")}</ul></details>` : ""}
        <details><summary>Activity</summary><ul class="agent-events">${job.events.map(e => `<li>${escape(e.text)}</li>`).join("")}</ul></details>
        <div class="agent-job-actions">${hasVideo ? `<button class="header-button" data-job-action="video" data-project="${escape(job.projectId)}">Open Video</button>` : ""}
        ${job.status === "done" && !job.approvedAt ? `<button class="header-button" data-job-action="approve-video" data-job="${escape(job.id)}">Approve</button>` : ""}
        ${["error", "needs_review", "canceled"].includes(job.status) && job.attempts < 3 ? `<button class="header-button" data-job-action="retry" data-job="${escape(job.id)}">Retry Job</button>` : ""}
        ${active ? `<button class="header-button" data-job-action="cancel" data-job="${escape(job.id)}">Cancel</button>` : ""}
        ${job.sessionId !== sessionId ? `<button class="header-button" data-job-action="chat" data-session="${escape(job.sessionId)}">Open Chat</button>` : ""}</div>
      </article>`;
    }).join("") || '<p class="library-hint">Jobs appear here when you send a brief. Progress is saved through restarts.</p>';
  }
  async function refresh() {
    try {
      state = await request("/api/agent/state");
      if (connectionError) notice("");
      connectionError = false;
      if (!state.sessions.length) { const session = await request("/api/agent/sessions", {}); state.sessions.unshift(session); sessionId = session.id; }
      if (!state.sessions.some(s => s.id === sessionId)) sessionId = state.sessions[0].id;
      localStorage.setItem("agentSessionId", sessionId); draw();
    } catch (err) { connectionError = true; notice(err.message); }
  }
  async function initAgent() {
    document.getElementById("agentOpen").onclick = () => { document.getElementById("agentWorkspace").hidden = false; refresh(); };
    document.getElementById("agentClose").onclick = () => { document.getElementById("agentWorkspace").hidden = true; refreshLibrary(); };
    document.getElementById("agentSession").onchange = e => setSession(e.target.value);
    document.getElementById("agentNewChat").onclick = async () => {
      try { const s = await request("/api/agent/sessions", {}); state.sessions.unshift(s); setSession(s.id); notice(""); } catch (err) { notice(err.message); }
    };
    document.getElementById("agentForm").onsubmit = async e => {
      e.preventDefault(); if (sending) return;
      const input = document.getElementById("agentBrief"); const message = input.value.trim(); if (!message) return;
      sending = true; document.getElementById("agentRun").disabled = true; notice("Saving brief to queue…");
      try {
        await request(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { message,
          targetSeconds: Number(document.getElementById("agentDuration").value), autoProduce: document.getElementById("agentAuto").checked });
        input.value = ""; notice("Brief queued. You can leave this view while the agent works.");
      } catch (err) { notice(err.message); }
      finally { sending = false; snapshot = ""; await refresh(); }
    };
    document.getElementById("agentJobs").oninput = e => { if (e.target.dataset.script) edits.set(e.target.dataset.script, e.target.value); };
    document.getElementById("agentJobs").onclick = async e => {
      const button = e.target.closest("[data-job-action]"); if (!button) return;
      const action = button.dataset.jobAction;
      if (action === "chat") { setSession(button.dataset.session); return; }
      if (action === "video") {
        document.getElementById("agentWorkspace").hidden = true; await refreshLibrary(); await selectProject(button.dataset.project); return;
      }
      button.disabled = true;
      try {
        const job = state.jobs.find(j => j.id === button.dataset.job);
        // "approve-video" is the human sign-off on a finished video; "approve" is the reviewed-script step.
        const endpoint = action === "approve-video" ? "approve" : action;
        const body = action === "approve" ? { scriptDe: edits.get(job.id) ?? job.scriptDe } : action === "approve-video" ? {} : {};
        await request(`/api/agent/jobs/${encodeURIComponent(job.id)}/${endpoint}`, body);
        notice(action === "retry" ? "Retry queued. Saved narration is reused when valid; an interrupted voice request may use credits again."
          : action === "approve-video" ? "Video approved." : "Job updated.");
        await refresh();
      } catch (err) { notice(err.message); button.disabled = false; }
    };
    await refresh(); setInterval(refresh, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAgent); else initAgent();
})();
