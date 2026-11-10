export const DIAGNOSIS_FIELDS = [
  ["experience", "Experiencia previa"],
  ["interests", "Intereses y expectativas"],
  ["strengths", "Fortalezas y habilidades observadas"],
  ["supportNeeds", "Aspectos por acompañar o explorar"],
  ["learningSupports", "Apoyos y estrategias para aprender"],
  ["initialGoals", "Primeros objetivos"]
];
export function diagnosisForStudent(diagnosis, studentId) {
  return diagnosis && String(diagnosis.studentId) === String(studentId) ? diagnosis : null;
}
export function renderDiagnosis(diagnosis, escape) {
  if (!diagnosis || !DIAGNOSIS_FIELDS.some(([key]) => diagnosis[key])) return "";
  return `<section class="initial-diagnosis"><h3>Diagnóstico inicial</h3>${DIAGNOSIS_FIELDS.map(([key,label]) => `<div class="field"><strong>${label}</strong><p style="white-space:pre-wrap">${escape(String(diagnosis[key] || "Por explorar"))}</p></div>`).join("")}</section>`;
}
