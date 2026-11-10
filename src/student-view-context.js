/** Contexto de presentación común. No cambia la sesión ni los permisos de Firebase. */
export function studentViewContext(context = {}) {
  if (!context.isViewingAsStudent) return context;
  const id = context.studentId;
  const accessProfile = { role: 'estudiante', studentIds: id ? [id] : [] };
  return {
    ...context,
    accessProfile,
    userCtx: accessProfile,
    isAdmin: false,
    isInternal: false,
    studentIds: id ? [id] : [],
    studentsById: new Map(id && context.student ? [[id, context.student]] : []),
  };
}
