const severityRank = { low: 1, moderate: 2, severe: 3, total_loss: 4 };

// Merges per-frame damage analyses (each tagged with scan_angle / bucket_index)
// into a single damage object matching the shape checkCoverage expects.
export function mergeDamageAnalyses(storedAnalyses = []) {
  const mergedAreas = new Map();
  const damageTypes = new Set();
  const fraudFlags = new Set();
  const safetyFlags = new Set();
  const recommendedActions = new Set();
  let topSeverity = 'unknown';

  storedAnalyses.forEach(analysis => {
    if (!analysis) return;
    if (analysis.damage_type) damageTypes.add(analysis.damage_type);
    if (severityRank[analysis.severity] > (severityRank[topSeverity] || 0)) topSeverity = analysis.severity;
    (analysis.fraud_flags || []).forEach(flag => fraudFlags.add(flag));
    (analysis.safety_flags || []).forEach(flag => safetyFlags.add(flag));
    (analysis.recommended_actions || []).forEach(action => recommendedActions.add(action));

    const areas = analysis.affected_areas || analysis.damaged_areas || [];
    areas.forEach(area => {
      const name = area.name || area.area_name || area.area || 'Unknown area';
      const key = name.trim().toLowerCase();
      const existing = mergedAreas.get(key);
      const severity = area.severity || analysis.severity || 'unknown';
      const next = {
        ...area,
        name,
        severity,
        source_angles: existing?.source_angles || [],
        source_buckets: existing?.source_buckets || [],
      };
      next.source_angles.push(analysis.scan_angle);
      next.source_buckets.push(analysis.bucket_index);

      const dedupedSources = {
        source_angles: [...new Set(next.source_angles.filter(v => v !== undefined))],
        source_buckets: [...new Set(next.source_buckets.filter(v => v !== undefined))],
      };

      if (!existing || (severityRank[severity] || 0) > (severityRank[existing.severity] || 0)) {
        mergedAreas.set(key, { ...existing, ...next, ...dedupedSources });
      } else {
        mergedAreas.set(key, { ...existing, ...dedupedSources });
      }
    });
  });

  const affectedAreas = [...mergedAreas.values()];
  return {
    damage_type: damageTypes.size ? [...damageTypes].join(', ') : 'unknown',
    severity: topSeverity,
    affected_areas: affectedAreas,
    damaged_areas: affectedAreas,
    fraud_flags: [...fraudFlags],
    safety_flags: [...safetyFlags],
    confidence: affectedAreas.length ? 'medium' : 'low',
    recommended_actions: [...recommendedActions],
    frame_assessments: storedAnalyses,
  };
}
