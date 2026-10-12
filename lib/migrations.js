export function migrateState(state) {
  for (const teacher of state.teachers || []) {
    const names = [teacher.full, teacher.sapa].map(n => String(n || '').trim().replace(/\s+/g, ' '));
    if (teacher.id === 't_kuanysh' || names.some(n => /^(Нұрдәулет Қуаныш|Қуаныш Нұрдәулет)$/.test(n))) {
      teacher.display = 'Нұрдәулет ағай';
      teacher.full = 'Қуаныш Нұрдәулет';
      teacher.sapa = 'Қуаныш Нұрдәулет';
    }
  }
  return state;
}
