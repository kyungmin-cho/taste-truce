// First-screen copy. Numbers are passed in by app.js from computed results.
const COPY=Object.freeze({headline:'Who gives up what to share a table',tableTitle:'Each friend’s rank for the same places',
  fairSummary:(rank,count)=>`Fair pick: no one ranks it below #${rank} of ${count} candidates.`,
  agrees:'Here the taste pick is also the popular pick',perspective:'Taste pick versus popularity'});
