import {
  isPlainObject,
  normalizeEmail,
  normalizeText,
  safeText,
  uniqueArray,
} from "./normalizers.js";

const ACADEMIC_FIELDS = Object.freeze([
  "processes",
  "area",
  "programa",
  "instrumento",
  "docente",
  "teacher",
  "modalidad",
  "modality",
  "intereses",
  "interesesMusicales",
  "repertoire",
  "repertorioEscogido",
  "repertorioProceso",
  "repertoireProgress",
  "historial",
  "history",
]);

const array = (value) => (Array.isArray(value) ? value : []);
const isStuId = (value) => /^stu_/i.test(safeText(value));
const documentId = (record) => safeText(record?.__documentId || record?.id);
const documentKey = (record) =>
  safeText(
    record?.documentFingerprint ||
      record?.documento ||
      record?.numeroDocumento ||
      record?.identificacion ||
      record?.cc
  )
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
const nameKey = (record) =>
  normalizeText(
    record?.displayName || record?.nombre || record?.name || record?.estudiante
  );
const emailKey = (record) =>
  normalizeEmail(
    record?.emailNormalized ||
      record?.email ||
      record?.correo ||
      record?.correoElectronico ||
      record?.mail
  );

function meaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return Boolean(safeText(value));
}

function academicScore(record = {}) {
  return ACADEMIC_FIELDS.reduce((score, field) => {
    const value = record[field];
    if (Array.isArray(value)) return score + value.length * 3;
    return score + (meaningful(value) ? 1 : 0);
  }, Number(record.bitacoraReferenceCount || 0) * 100);
}

function canonicalScore(record = {}) {
  const id = documentId(record);
  let score = isStuId(id) ? 0 : 10;
  if (safeText(record.identitySource) === "estudiantes-musicala") score += 30;
  if (safeText(record.studentId) === id) score += 15;
  if (isPlainObject(record.rip)) score += 10;
  return score;
}

function createSet(ids = []) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    let root = parent.get(id);
    while (root !== parent.get(root)) {
      parent.set(root, parent.get(parent.get(root)));
      root = parent.get(root);
    }
    parent.set(id, root);
    return root;
  };
  const union = (left, right) => {
    if (!parent.has(left) || !parent.has(right)) return;
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  return { find, union };
}

function groupBy(records, getKey) {
  const groups = new Map();
  records.forEach((record) => {
    const key = getKey(record);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return groups;
}

function buildLogical(group, evidence = []) {
  const canonical =
    [...group].sort((left, right) => canonicalScore(right) - canonicalScore(left))[0];
  const bestAcademic =
    [...group].sort((left, right) => {
      const delta = academicScore(right) - academicScore(left);
      if (delta) return delta;
      if (isStuId(documentId(left)) !== isStuId(documentId(right))) {
        return isStuId(documentId(right)) ? 1 : -1;
      }
      return 0;
    })[0] || canonical;
  const academic =
    academicScore(bestAcademic) > academicScore(canonical)
      ? bestAcademic
      : canonical;
  const merged = { ...academic, ...canonical };

  ACADEMIC_FIELDS.forEach((field) => {
    if (meaningful(academic?.[field])) merged[field] = academic[field];
  });

  const canonicalStudentId = documentId(canonical);
  const academicRecordId = documentId(academic) || canonicalStudentId;
  const linkedStudentIds = uniqueArray(group.map(documentId).filter(Boolean));

  return {
    ...merged,
    id: canonicalStudentId,
    studentId: canonicalStudentId,
    studentKey: canonicalStudentId,
    canonicalStudentId,
    academicRecordId,
    linkedStudentIds,
    identityDocumentId: canonicalStudentId,
    identityDocument: canonical,
    academicDocument: academic,
    identityResolutionStatus:
      linkedStudentIds.length > 1 ? "resolved" : "single",
    identityResolutionEvidence: uniqueArray(evidence),
  };
}

function buildPending(group) {
  const representative =
    [...group].sort(
      (left, right) =>
        academicScore(right) - academicScore(left) ||
        canonicalScore(right) - canonicalScore(left)
    )[0] || group[0];
  const id = documentId(representative);
  return {
    ...representative,
    id,
    studentId: id,
    studentKey: id,
    canonicalStudentId: id,
    academicRecordId: id,
    linkedStudentIds: id ? [id] : [],
    identityResolutionStatus: "pending",
    identityResolutionLabel: "Revisión de identidad pendiente",
    identityResolutionCandidateCount: group.length,
  };
}

export function resolveLogicalStudentRecords(records = []) {
  const items = records
    .filter(Boolean)
    .map((record) => ({
      ...record,
      __documentId: documentId(record),
    }))
    .filter((record) => documentId(record));
  const byId = new Map(items.map((record) => [documentId(record), record]));
  const { find, union } = createSet([...byId.keys()]);
  const evidence = new Map();
  const link = (left, right, reason) => {
    if (!byId.has(left) || !byId.has(right) || left === right) return;
    const pair = [left, right].sort().join("|");
    if (!evidence.has(pair)) evidence.set(pair, new Set());
    evidence.get(pair).add(reason);
    union(left, right);
  };

  items.forEach((record) => {
    const id = documentId(record);
    ["canonicalStudentId", "legacyAliasOf"].forEach((field) => {
      link(id, safeText(record[field]), field);
    });
    ["aliases", "linkedStudentIds"].forEach((field) => {
      array(record[field]).forEach((target) => link(id, safeText(target), field));
    });

    array(record.studentIds).forEach((targetValue) => {
      const target = byId.get(safeText(targetValue));
      if (!target) return;
      const sameDocument =
        documentKey(record) && documentKey(record) === documentKey(target);
      const sameEmailAndName =
        emailKey(record) &&
        emailKey(record) === emailKey(target) &&
        nameKey(record) &&
        nameKey(record) === nameKey(target);
      if (sameDocument || sameEmailAndName) {
        link(
          id,
          documentId(target),
          sameDocument ? "studentIds_document" : "studentIds_email"
        );
      }
    });
  });

  groupBy(items, documentKey).forEach((group) => {
    for (let index = 1; index < group.length; index += 1) {
      link(documentId(group[0]), documentId(group[index]), "documentFingerprint");
    }
  });

  const pendingGroups = [];
  groupBy(items, emailKey).forEach((emailGroup) => {
    groupBy(emailGroup, nameKey).forEach((sameIdentityGroup) => {
      const stu = sameIdentityGroup.filter((record) =>
        isStuId(documentId(record))
      );
      const canonical = sameIdentityGroup.filter(
        (record) => !isStuId(documentId(record))
      );
      if (!stu.length || !canonical.length) return;
      if (canonical.length === 1) {
        sameIdentityGroup.forEach((record) => {
          link(
            documentId(canonical[0]),
            documentId(record),
            "emailNormalized"
          );
        });
      } else {
        pendingGroups.push(sameIdentityGroup);
      }
    });
  });

  const groups = new Map();
  items.forEach((record) => {
    const root = find(documentId(record));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(record);
  });

  const pendingIds = new Set(
    pendingGroups.flatMap((group) => group.map(documentId))
  );
  const resolved = [...groups.values()]
    .filter((group) => !group.some((record) => pendingIds.has(documentId(record))))
    .map((group) => {
      const reasons = new Set();
      for (let left = 0; left < group.length; left += 1) {
        for (let right = left + 1; right < group.length; right += 1) {
          const pair = [documentId(group[left]), documentId(group[right])]
            .sort()
            .join("|");
          (evidence.get(pair) || []).forEach((reason) => reasons.add(reason));
        }
      }
      return buildLogical(group, [...reasons]);
    });

  return [...resolved, ...pendingGroups.map(buildPending)];
}
