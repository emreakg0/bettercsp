// Calendar display aliases are separate from campus identity used by the scheduler.
export const calendarCampuses = {
  online: 'Online',
  busch: 'Busch',
  'college-avenue': 'College Avenue',
  'cook-douglass': 'Cook/Douglass',
  livingston: 'Livingston',
  downtown: 'Downtown',
  camden: 'Camden',
  newark: 'Newark',
  other: 'Other / Unknown',
} as const;

type CalendarCampus = keyof typeof calendarCampuses;
const aliases: Readonly<Record<Exclude<CalendarCampus, 'other'>, readonly string[]>> = {
  online: ['online', 'onl', 'o', 'remote'],
  busch: ['busch', 'busch campus', 'bus', '2'],
  'college-avenue': ['college avenue', 'college avenue campus', 'college ave', 'college ave campus', 'cac', '1'],
  'cook-douglass': ['cook', 'douglass', 'douglas', 'cook campus', 'douglass campus', 'cook douglass', 'cook douglas',
    'douglass cook', 'douglas cook', 'cook douglass campus', 'd c', 'c d', '4'],
  livingston: ['livingston', 'livingston campus', 'liv', '3'],
  downtown: ['downtown', 'downtown nb', 'downtown new brunswick', 'dnb', '5'],
  camden: ['camden', 'camden campus', 'rutgers camden', 'rutgers university camden'],
  newark: ['newark', 'newark campus', 'rutgers newark', 'rutgers university newark'],
};

const campusByAlias = new Map<string, CalendarCampus>();
for (const campus of Object.keys(aliases) as Exclude<CalendarCampus, 'other'>[]) {
  for (const alias of aliases[campus]) campusByAlias.set(alias, campus);
}

export function calendarCampus(name: string): CalendarCampus {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return campusByAlias.get(key) ?? 'other';
}
