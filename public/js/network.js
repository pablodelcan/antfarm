// =====================================================================
//  ANTFARM v12 — Network: checkpoint save/load, AI directive polling
//  Live shared view: leader election so only one client saves
// =====================================================================

'use strict';

AF.network = {
  sessionId: Math.random().toString(36).slice(2, 10),
  lastSave: 0,
  lastDirectiveFetch: 0,
  lastSync: 0,
  isLeader: false,
  leaderCheckDone: false,
  SAVE_INTERVAL: 30000,       // Leader saves checkpoint every 30 seconds
  DIRECTIVE_POLL: 30000,      // Poll for AI directive every 30 seconds
  SYNC_INTERVAL: 15000,       // Non-leaders sync from server every 15 seconds

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

  // Claim leadership (or check if we are the leader)
  async claimLeader() {
    try {
      const res = await fetch('/api/leader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: this.sessionId })
      });
      if (!res.ok) {
        // Leader endpoint not deployed yet, fall back to always-save
        this.isLeader = true;
        return;
      }
      const data = await res.json();
      this.isLeader = data.isLeader;
    } catch (e) {
      // If leader endpoint doesn't exist, everyone saves (backward compatible)
      this.isLeader = true;
    }
    this.leaderCheckDone = true;
  },

  // Save checkpoint to server (rate-limited, leader only)
  async saveCheckpoint(state) {
    // Claim leadership on first call
    if (!this.leaderCheckDone) {
      await this.claimLeader();
    }

    if (!this.isLeader) return;
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
  },

  // Sync state from server for non-leader clients
  async syncFromServer(state) {
    if (this.isLeader) return null; // Leader doesn't sync — it saves
    if (Date.now() - this.lastSync < this.SYNC_INTERVAL) return null;
    this.lastSync = Date.now();
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return null;
      const data = await res.json();
      if (data.checkpoint) {
        return data;
      }
    } catch (e) {
      // Silent fail
    }
    return null;
  }
};
