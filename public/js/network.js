// =====================================================================
//  ANTFARM v10 — Network: checkpoint save/load, AI directive polling
// =====================================================================

'use strict';

AF.network = {
  sessionId: Math.random().toString(36).slice(2, 10),
  lastSave: 0,
  lastDirectiveFetch: 0,
  SAVE_INTERVAL: 60000,       // Save checkpoint every 60 seconds
  DIRECTIVE_POLL: 30000,      // Poll for AI directive every 30 seconds

  // Load last checkpoint from server
  async fetchCheckpoint() {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status === 'initializing') return null;
      return data;
    } catch (e) {
      console.warn('Failed to fetch checkpoint:', e);
      return null;
    }
  },

  // Save checkpoint to server (rate-limited)
  async saveCheckpoint(state) {
    if (Date.now() - this.lastSave < this.SAVE_INTERVAL) return;
    this.lastSave = Date.now();
    try {
      const compact = AF.colony.serialize(state);
      const snapshot = AF.colony.getSnapshot(state);
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: compact, snapshot: snapshot, session: this.sessionId })
      });
      const data = await res.json();
      // If server triggered Claude AI, apply the directive
      if (data.directive) {
        AF.colony.applyDirective(state, data.directive);
      }
      return data;
    } catch (e) {
      console.warn('Failed to save checkpoint:', e);
      return null;
    }
  },

  // Poll for new AI directive
  async pollDirective(state) {
    if (Date.now() - this.lastDirectiveFetch < this.DIRECTIVE_POLL) return;
    this.lastDirectiveFetch = Date.now();
    try {
      const res = await fetch('/api/state?directiveOnly=1');
      if (!res.ok) return;
      const data = await res.json();
      if (data.directive) {
        AF.colony.applyDirective(state, data.directive);
      }
    } catch (e) {
      // Silent fail — not critical
    }
  }
};
