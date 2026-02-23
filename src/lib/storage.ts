import { getLayoutMetrics, normalizeClassroomLayout, getGroupCountBySize, getActiveGroupIndices, placeCentered } from './classroom';
import type { AppState, Classroom, LayoutMode, Student, TimeModeConfig, TimeMode } from '../types';

const STORAGE_KEY = 'class-sit-table/app-state-v1';
const APP_VERSION = 3;

function isStudent(value: unknown): value is Student {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Student>;
  return typeof candidate.id === 'string' && typeof candidate.name === 'string';
}

function toStringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function isLayoutMode(value: unknown): value is LayoutMode {
  return value === 'THREE_ROWS' || value === 'GROUPS' || value === 'ARC';
}

function isTimeMode(value: unknown): value is TimeMode {
  return value === 'weekday' || value === 'weekend';
}

function normalizeTimeModeConfig(value: unknown, students: Student[], fallbackMode: LayoutMode): TimeModeConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const layoutMode: LayoutMode = isLayoutMode(candidate.layoutMode)
    ? candidate.layoutMode
    : fallbackMode;

  const studentIds = new Set(students.map((s) => s.id));
  const seats = Array.isArray(candidate.seats)
    ? candidate.seats.map((seat) =>
        typeof seat === 'string' && studentIds.has(seat) ? seat : null,
      )
    : [];

  const metrics = getLayoutMetrics(layoutMode, students.length);

  return {
    layoutMode,
    rows: typeof candidate.rows === 'number' ? candidate.rows : metrics.rows,
    cols: typeof candidate.cols === 'number' ? candidate.cols : metrics.cols,
    seats,
    rotationCount: typeof candidate.rotationCount === 'number' ? candidate.rotationCount : 0,
    weekLabel: toStringOrDefault(candidate.weekLabel, '第1周'),
    classTime: toStringOrDefault(candidate.classTime, ''),
  };
}

function normalizeClassroom(value: unknown): Classroom | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null;
  }

  // Students can be at top level or shared
  const rawStudents = Array.isArray(candidate.students) ? candidate.students : [];
  const students = rawStudents.filter((student) => isStudent(student));

  if (students.length === 0 && !candidate.weekday && !candidate.weekend) {
    // Try to detect old flat format (v2)
    if (Array.isArray(candidate.seats)) {
      return migrateV2Classroom(candidate, students);
    }
  }

  // New format: has weekday/weekend TimeModeConfig
  const weekday = normalizeTimeModeConfig(candidate.weekday, students, 'GROUPS')
    ?? createDefaultTimeModeConfig(students);
  const weekend = normalizeTimeModeConfig(candidate.weekend, students, 'GROUPS')
    ?? createDefaultTimeModeConfig(students);

  const classroom: Classroom = {
    id: candidate.id,
    name: (candidate.name as string).trim() || '未命名班级',
    students,
    campus: toStringOrDefault(candidate.campus, ''),
    building: toStringOrDefault(candidate.building, ''),
    room: toStringOrDefault(candidate.room, ''),
    sideNotes: toStringOrDefault(candidate.sideNotes, ''),
    updatedAt:
      typeof candidate.updatedAt === 'string' && !Number.isNaN(new Date(candidate.updatedAt).valueOf())
        ? candidate.updatedAt
        : new Date().toISOString(),
    weekday,
    weekend,
  };

  return normalizeClassroomLayout(normalizeClassroomLayout(classroom, 'weekday'), 'weekend');
}

/** Migrate old flat Classroom format (v2) to new weekday/weekend format */
function migrateV2Classroom(candidate: Record<string, unknown>, students: Student[]): Classroom | null {
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null;
  }

  const rawStudents = Array.isArray(candidate.students) ? candidate.students.filter(isStudent) : students;
  const studentIds = new Set(rawStudents.map((s) => s.id));

  const inferredMode: LayoutMode = isLayoutMode(candidate.layoutMode)
    ? candidate.layoutMode
    : typeof candidate.rows === 'number' && candidate.rows <= 3
      ? 'THREE_ROWS'
      : 'GROUPS';

  const seats = Array.isArray(candidate.seats)
    ? candidate.seats.map((seat) =>
        typeof seat === 'string' && studentIds.has(seat) ? seat : null,
      )
    : [];

  const metrics = getLayoutMetrics(inferredMode, rawStudents.length);

  const config: TimeModeConfig = {
    layoutMode: inferredMode,
    rows: typeof candidate.rows === 'number' ? candidate.rows : metrics.rows,
    cols: typeof candidate.cols === 'number' ? candidate.cols : metrics.cols,
    seats,
    rotationCount: typeof candidate.rotationCount === 'number' ? candidate.rotationCount : 0,
    weekLabel: toStringOrDefault(candidate.weekLabel, '第1周'),
    classTime: toStringOrDefault(candidate.classTime, ''),
  };

  const emptyConfig = createDefaultTimeModeConfig(rawStudents);

  const classroom: Classroom = {
    id: candidate.id,
    name: (candidate.name as string).trim() || '未命名班级',
    students: rawStudents,
    campus: toStringOrDefault(candidate.campus, ''),
    building: toStringOrDefault(candidate.building, ''),
    room: toStringOrDefault(candidate.room, ''),
    sideNotes: toStringOrDefault(candidate.sideNotes, ''),
    updatedAt:
      typeof candidate.updatedAt === 'string' && !Number.isNaN(new Date(candidate.updatedAt).valueOf())
        ? candidate.updatedAt
        : new Date().toISOString(),
    weekday: config,
    weekend: emptyConfig,
  };

  return normalizeClassroomLayout(normalizeClassroomLayout(classroom, 'weekday'), 'weekend');
}

function createDefaultTimeModeConfig(students: Student[]): TimeModeConfig {
  const metrics = getLayoutMetrics('GROUPS', students.length);
  return {
    layoutMode: 'GROUPS',
    rows: metrics.rows,
    cols: metrics.cols,
    seats: Array.from({ length: metrics.capacity }, () => null),
    rotationCount: 0,
    weekLabel: '第1周',
    classTime: '',
  };
}

const LEGACY_STORAGE_KEY = 'classSeatingData';

function createMigrationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Migrate old prev.html data format (classSeatingData) to new AppState.
 * Old format: { className: { weekday: { layout, groups, rowGroups, arcGroups, currentArrangement, locationInfo }, weekend: {...} } }
 */
function migrateLegacyData(): AppState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;

    const classData = JSON.parse(raw) as Record<string, unknown>;
    if (!classData || typeof classData !== 'object') return null;

    const classrooms: Classroom[] = [];

    for (const [className, classValue] of Object.entries(classData)) {
      if (!classValue || typeof classValue !== 'object') continue;
      const classEntry = classValue as Record<string, unknown>;

      // Collect all student names across both time modes
      const allNames = new Set<string>();
      for (const timeKey of ['weekday', 'weekend'] as const) {
        const modeData = classEntry[timeKey] as Record<string, unknown> | undefined;
        if (!modeData) continue;
        collectNamesFromLegacyMode(modeData, allNames);
      }

      if (allNames.size === 0) continue;

      // Create Student objects with stable IDs
      const nameList = [...allNames];
      const students: Student[] = nameList.map((name) => ({
        id: createMigrationId(),
        name,
      }));
      const nameToId = new Map(students.map((s) => [s.name, s.id]));

      // Build configs for weekday and weekend
      const weekday = migrateLegacyTimeMode(
        classEntry.weekday as Record<string, unknown> | undefined,
        students,
        nameToId,
      );
      const weekend = migrateLegacyTimeMode(
        classEntry.weekend as Record<string, unknown> | undefined,
        students,
        nameToId,
      );

      // Extract location info from weekday
      const weekdayInfo = getLocationInfo(classEntry.weekday as Record<string, unknown> | undefined);
      const weekendInfo = getLocationInfo(classEntry.weekend as Record<string, unknown> | undefined);

      const classroom: Classroom = {
        id: createMigrationId(),
        name: className,
        students,
        campus: weekdayInfo.campus || weekendInfo.campus,
        building: weekdayInfo.floor || weekendInfo.floor,
        room: weekdayInfo.room || weekendInfo.room,
        sideNotes: weekdayInfo.notes || weekendInfo.notes,
        updatedAt: new Date().toISOString(),
        weekday,
        weekend,
      };

      classrooms.push(
        normalizeClassroomLayout(normalizeClassroomLayout(classroom, 'weekday'), 'weekend'),
      );
    }

    if (classrooms.length === 0) return null;

    return {
      version: APP_VERSION,
      classrooms,
      activeClassroomId: classrooms[0].id,
      activeTimeMode: 'weekday',
    };
  } catch {
    return null;
  }
}

function collectNamesFromLegacyMode(modeData: Record<string, unknown>, names: Set<string>): void {
  const layout = modeData.layout as string | undefined;

  if (layout === 'circular' || !layout) {
    // groups: string[][] (6×6)
    const groups = modeData.groups;
    if (Array.isArray(groups)) {
      for (const group of groups) {
        if (Array.isArray(group)) {
          for (const name of group) {
            if (typeof name === 'string' && name.trim()) names.add(name.trim());
          }
        }
      }
    }
  }

  if (layout === 'rows') {
    const rowGroups = modeData.rowGroups as Record<string, unknown> | undefined;
    if (rowGroups && Array.isArray(rowGroups.rows)) {
      for (const row of rowGroups.rows) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        for (const side of ['left', 'right'] as const) {
          if (Array.isArray(r[side])) {
            for (const name of r[side] as unknown[]) {
              if (typeof name === 'string' && name.trim()) names.add(name.trim());
            }
          }
        }
      }
    }
  }

  if (layout === 'arc') {
    const arcGroups = modeData.arcGroups as Record<string, unknown> | undefined;
    if (arcGroups && Array.isArray(arcGroups.rows)) {
      for (const row of arcGroups.rows) {
        if (Array.isArray(row)) {
          for (const name of row) {
            if (typeof name === 'string' && name.trim()) names.add(name.trim());
          }
        }
      }
    }
  }
}

function migrateLegacyTimeMode(
  modeData: Record<string, unknown> | undefined,
  students: Student[],
  nameToId: Map<string, string>,
): TimeModeConfig {
  if (!modeData) {
    return createDefaultTimeModeConfig(students);
  }

  const oldLayout = modeData.layout as string | undefined;
  const layoutMode: LayoutMode = oldLayout === 'rows' ? 'THREE_ROWS' : oldLayout === 'arc' ? 'ARC' : 'GROUPS';
  const metrics = getLayoutMetrics(layoutMode, students.length);
  const seats: Array<string | null> = Array.from({ length: metrics.capacity }, () => null);

  if (layoutMode === 'GROUPS') {
    const groups = modeData.groups;
    if (Array.isArray(groups)) {
      const activeIndices = getActiveGroupIndices(getGroupCountBySize(students.length));
      for (let gi = 0; gi < groups.length && gi < 6; gi++) {
        const group = groups[gi];
        if (!Array.isArray(group)) continue;
        for (let si = 0; si < group.length && si < 6; si++) {
          const name = typeof group[si] === 'string' ? group[si].trim() : '';
          if (name && nameToId.has(name)) {
            seats[gi * 6 + si] = nameToId.get(name)!;
          }
        }
      }
    }
  } else if (layoutMode === 'THREE_ROWS') {
    const rowGroups = modeData.rowGroups as Record<string, unknown> | undefined;
    if (rowGroups && Array.isArray(rowGroups.rows)) {
      const cols = metrics.cols;
      const leftSize = Math.ceil(cols / 2);
      for (let row = 0; row < 3 && row < (rowGroups.rows as unknown[]).length; row++) {
        const r = (rowGroups.rows as Record<string, unknown>[])[row];
        if (!r) continue;
        const left = Array.isArray(r.left) ? r.left : [];
        const right = Array.isArray(r.right) ? r.right : [];

        for (let i = 0; i < leftSize && i < left.length; i++) {
          const name = typeof left[i] === 'string' ? (left[i] as string).trim() : '';
          if (name && nameToId.has(name)) {
            seats[row * cols + i] = nameToId.get(name)!;
          }
        }
        for (let i = 0; i < (cols - leftSize) && i < right.length; i++) {
          const name = typeof right[i] === 'string' ? (right[i] as string).trim() : '';
          if (name && nameToId.has(name)) {
            seats[row * cols + leftSize + i] = nameToId.get(name)!;
          }
        }
      }
    }
  } else if (layoutMode === 'ARC') {
    const arcGroups = modeData.arcGroups as Record<string, unknown> | undefined;
    if (arcGroups && Array.isArray(arcGroups.rows)) {
      for (let row = 0; row < 2 && row < (arcGroups.rows as unknown[]).length; row++) {
        const rowData = (arcGroups.rows as unknown[][])[row];
        if (!Array.isArray(rowData)) continue;
        // Old format stores arc students in order; new format uses centered placement
        const rowNames: string[] = [];
        for (const name of rowData) {
          if (typeof name === 'string' && name.trim() && nameToId.has(name.trim())) {
            rowNames.push(nameToId.get(name.trim())!);
          }
        }
        placeCentered(seats, rowNames, row * 18, 18);
      }
    }
  }

  const locationInfo = getLocationInfo(modeData);
  const classTime = [locationInfo.weekday, locationInfo.time].filter(Boolean).join(' ');
  const weekLabel = locationInfo.date && locationInfo.day
    ? `${locationInfo.date}月${locationInfo.day}日`
    : '第1周';

  return {
    layoutMode,
    rows: metrics.rows,
    cols: metrics.cols,
    seats,
    rotationCount: typeof modeData.currentArrangement === 'number' ? modeData.currentArrangement : 0,
    weekLabel,
    classTime,
  };
}

function getLocationInfo(modeData: Record<string, unknown> | undefined): {
  campus: string; floor: string; room: string; notes: string; date: string; day: string; weekday: string; time: string;
} {
  const empty = { campus: '', floor: '', room: '', notes: '', date: '', day: '', weekday: '', time: '' };
  if (!modeData) return empty;
  const info = modeData.locationInfo as Record<string, unknown> | undefined;
  if (!info || typeof info !== 'object') return empty;

  return {
    campus: typeof info.campus === 'string' ? info.campus : '',
    floor: typeof info.floor === 'string' ? info.floor : '',
    room: typeof info.room === 'string' ? info.room : '',
    notes: typeof info.notes === 'string' ? info.notes : '',
    date: typeof info.date === 'string' ? info.date : '',
    day: typeof info.day === 'string' ? info.day : '',
    weekday: typeof info.weekday === 'string' ? info.weekday : '',
    time: typeof info.time === 'string' ? info.time : '',
  };
}

export function getEmptyState(): AppState {
  return {
    version: APP_VERSION,
    classrooms: [],
    activeClassroomId: null,
    activeTimeMode: 'weekday',
  };
}

export function normalizeState(value: unknown): AppState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<AppState>;
  if (!Array.isArray(candidate.classrooms)) {
    return null;
  }

  const classrooms = candidate.classrooms
    .map((classroom) => normalizeClassroom(classroom))
    .filter((classroom): classroom is Classroom => Boolean(classroom));

  const activeClassroomId =
    typeof candidate.activeClassroomId === 'string' &&
    classrooms.some((classroom) => classroom.id === candidate.activeClassroomId)
      ? candidate.activeClassroomId
      : classrooms[0]?.id ?? null;

  const activeTimeMode: TimeMode = isTimeMode((candidate as Record<string, unknown>).activeTimeMode)
    ? (candidate as Record<string, unknown>).activeTimeMode as TimeMode
    : 'weekday';

  return {
    version: APP_VERSION,
    classrooms,
    activeClassroomId,
    activeTimeMode,
  };
}

export function loadState(): AppState {
  if (typeof window === 'undefined') {
    return getEmptyState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Try to migrate legacy data from prev.html
      const migrated = migrateLegacyData();
      if (migrated) {
        // Save migrated data to new key
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return getEmptyState();
    }

    const parsed = JSON.parse(raw) as unknown;
    return normalizeState(parsed) ?? getEmptyState();
  } catch {
    return getEmptyState();
  }
}

export function saveState(state: AppState): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function parseBackup(rawText: string): AppState | null {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

export function formatBackupFilename(): string {
  const dateText = new Date().toISOString().slice(0, 10);
  return `class-seat-backup-${dateText}.json`;
}
