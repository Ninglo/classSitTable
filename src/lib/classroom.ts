import type { Classroom, LayoutMode, Student, TimeModeConfig, TimeMode } from '../types';

const MIN_SIZE = 1;
const MAX_SIZE = 14;
const MIN_GROUPS = 3;
const MAX_GROUPS = 6;
const GROUP_CAPACITY = 6;
const GROUP_ROWS = 3;
const GROUP_ROW_SIZE = 2;
const THREE_ROWS = 3;
const DEFAULT_THREE_ROW_COLS = 6;
const MAX_THREE_ROW_COLS = 12;
const ARC_ROWS = 2;
const ARC_COLS = 18;

export const MAX_STUDENTS = 36;

export interface LayoutMetrics {
  mode: LayoutMode;
  rows: number;
  cols: number;
  groupCount: number;
  capacity: number;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function clampSize(value: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(value)));
}

function createEmptySeats(capacity: number): Array<string | null> {
  return Array.from({ length: Math.max(0, capacity) }, () => null);
}

function uniqueNames(input: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const rawName of input) {
    const name = rawName.replace(/\s+/g, ' ').trim();
    if (!name) {
      continue;
    }

    if (!seen.has(name)) {
      names.push(name);
      seen.add(name);
    }
  }

  return names;
}

function getOrderedStudentIds(students: Student[], seats: Array<string | null>): string[] {
  const validIds = new Set(students.map((student) => student.id));
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const studentId of seats) {
    if (studentId && validIds.has(studentId) && !seen.has(studentId)) {
      ordered.push(studentId);
      seen.add(studentId);
    }
  }

  for (const student of students) {
    if (!seen.has(student.id)) {
      ordered.push(student.id);
      seen.add(student.id);
    }
  }

  return ordered;
}

function buildSeatsFromOrder(studentIds: string[], capacity: number): Array<string | null> {
  const seats = createEmptySeats(capacity);
  studentIds.slice(0, capacity).forEach((studentId, index) => {
    seats[index] = studentId;
  });
  return seats;
}

function compactSeatsToFront(seats: Array<string | null>, students: Student[]): Array<string | null> {
  const validIds = new Set(students.map((student) => student.id));
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const seat of seats) {
    if (seat && validIds.has(seat) && !seen.has(seat)) {
      ordered.push(seat);
      seen.add(seat);
    }
  }

  for (const student of students) {
    if (!seen.has(student.id)) {
      ordered.push(student.id);
      seen.add(student.id);
    }
  }

  return buildSeatsFromOrder(ordered, seats.length);
}

// --- Group count & active indices ---

export function getGroupCountBySize(studentCount: number): number {
  if (studentCount <= 0) {
    return MIN_GROUPS;
  }

  return Math.max(MIN_GROUPS, Math.min(MAX_GROUPS, Math.ceil(studentCount / GROUP_CAPACITY)));
}

/** 4 groups -> [0,1,2,4] (skip index 3, i.e. Group 1,2,3,5). Others -> [0..n-1]. */
export function getActiveGroupIndices(groupCount: number): number[] {
  if (groupCount === 4) return [0, 1, 2, 4];
  return Array.from({ length: groupCount }, (_, i) => i);
}

// --- Layout metrics ---

export function getLayoutMetrics(layoutMode: LayoutMode, studentCount: number): LayoutMetrics {
  if (layoutMode === 'GROUPS') {
    const groupCount = getGroupCountBySize(studentCount);

    return {
      mode: layoutMode,
      rows: groupCount * GROUP_ROWS,
      cols: GROUP_ROW_SIZE,
      groupCount,
      capacity: MAX_GROUPS * GROUP_CAPACITY, // always 36 slots (6 groups * 6)
    };
  }

  if (layoutMode === 'ARC') {
    return {
      mode: layoutMode,
      rows: ARC_ROWS,
      cols: ARC_COLS,
      groupCount: 0,
      capacity: ARC_ROWS * ARC_COLS,
    };
  }

  // THREE_ROWS
  const basis = studentCount > 0 ? studentCount : DEFAULT_THREE_ROW_COLS * THREE_ROWS;
  const cols = Math.max(MIN_SIZE, Math.min(MAX_THREE_ROW_COLS, Math.ceil(basis / THREE_ROWS)));

  return {
    mode: layoutMode,
    rows: THREE_ROWS,
    cols,
    groupCount: 0,
    capacity: THREE_ROWS * cols,
  };
}

// --- Centered placement for ARC ---

export function placeCentered(
  seats: Array<string | null>,
  studentIds: string[],
  startIndex: number,
  rowWidth: number,
): void {
  let centerLeft = Math.floor((rowWidth - 1) / 2);
  let centerRight = centerLeft + 1;
  let useLeft = true;
  let idx = 0;

  while (idx < studentIds.length && (centerLeft >= 0 || centerRight < rowWidth)) {
    if (useLeft && centerLeft >= 0) {
      seats[startIndex + centerLeft] = studentIds[idx];
      centerLeft--;
      idx++;
    } else if (!useLeft && centerRight < rowWidth) {
      seats[startIndex + centerRight] = studentIds[idx];
      centerRight++;
      idx++;
    }
    useLeft = !useLeft;
  }
}

// --- Config helpers ---

function createEmptyConfig(layoutMode: LayoutMode, studentCount: number): TimeModeConfig {
  const metrics = getLayoutMetrics(layoutMode, studentCount);
  return {
    layoutMode,
    rows: metrics.rows,
    cols: metrics.cols,
    seats: createEmptySeats(metrics.capacity),
    rotationCount: 0,
    weekLabel: '第1周',
    classTime: '',
  };
}

function withLayout(config: TimeModeConfig, layoutMode: LayoutMode, students: Student[]): TimeModeConfig {
  const metrics = getLayoutMetrics(layoutMode, students.length);

  if (layoutMode === 'ARC') {
    const ordered = getOrderedStudentIds(students, config.seats);
    const seats = createEmptySeats(metrics.capacity);
    const half = Math.ceil(ordered.length / 2);
    const firstRow = ordered.slice(0, half);
    const secondRow = ordered.slice(half);
    placeCentered(seats, firstRow, 0, ARC_COLS);
    placeCentered(seats, secondRow, ARC_COLS, ARC_COLS);

    return {
      ...config,
      layoutMode,
      rows: metrics.rows,
      cols: metrics.cols,
      seats,
    };
  }

  const seats = buildSeatsFromOrder(getOrderedStudentIds(students, config.seats), metrics.capacity);

  return {
    ...config,
    layoutMode,
    rows: metrics.rows,
    cols: metrics.cols,
    seats,
  };
}

// --- Rotation: Groups (circular table) ---

/**
 * Old prev.html behavior:
 * 1. Internal rotation: within each group, non-empty students shift (first -> last)
 * 2. Position mapping is done at render time via getRotationMapping()
 */
function rotateGroupLayout(config: TimeModeConfig, students: Student[]): TimeModeConfig {
  const normalized = withLayout(config, 'GROUPS', students);
  const groupCount = getGroupCountBySize(students.length);
  const activeIndices = getActiveGroupIndices(groupCount);
  const nextSeats = [...normalized.seats];

  // Internal rotation within each active group
  for (const groupIdx of activeIndices) {
    const start = groupIdx * GROUP_CAPACITY;
    const groupStudents: (string | null)[] = [];

    for (let i = 0; i < GROUP_CAPACITY; i++) {
      groupStudents.push(nextSeats[start + i]);
    }

    // Collect non-empty
    const nonEmpty = groupStudents.filter((s): s is string => s !== null);
    if (nonEmpty.length > 1) {
      // Rotate: first -> last
      const rotated = [...nonEmpty.slice(1), nonEmpty[0]];
      for (let i = 0; i < GROUP_CAPACITY; i++) {
        nextSeats[start + i] = i < rotated.length ? rotated[i] : null;
      }
    }
  }

  return {
    ...normalized,
    seats: nextSeats,
    rotationCount: normalized.rotationCount + 1,
  };
}

/**
 * Compute which group data to show at each physical table position.
 * mapping[physicalPosition] = groupDataIndex
 */
export function getRotationMapping(groupCount: number, rotationCount: number): number[] {
  const activeIndices = getActiveGroupIndices(groupCount);
  const n = activeIndices.length;
  const shift = rotationCount % n;
  const mapping = Array(MAX_GROUPS).fill(-1);

  for (let i = 0; i < n; i++) {
    const physicalPos = activeIndices[i];
    const groupIdx = activeIndices[(i - shift + n) % n];
    mapping[physicalPos] = groupIdx;
  }

  // Non-active positions map to themselves
  for (let pos = 0; pos < MAX_GROUPS; pos++) {
    if (mapping[pos] === -1) {
      mapping[pos] = pos;
    }
  }

  return mapping;
}

// --- Rotation: Three rows (left/right split) ---

/**
 * Old prev.html behavior:
 * 1. Each row's left and right halves rotate internally (first non-empty -> last)
 * 2. Rows shift cyclically: row0->row2, row1->row0, row2->row1
 */
function rotateThreeRows(config: TimeModeConfig, students: Student[]): TimeModeConfig {
  const normalized = withLayout(config, 'THREE_ROWS', students);
  const cols = normalized.cols;
  const nextSeats = createEmptySeats(normalized.seats.length);

  // Step 1: Internal rotation for each row's left and right halves
  const rotatedRows: Array<Array<string | null>> = [];

  for (let row = 0; row < THREE_ROWS; row++) {
    const start = row * cols;
    const leftSize = Math.ceil(cols / 2);

    // Collect left and right halves
    const left: (string | null)[] = [];
    const right: (string | null)[] = [];

    for (let c = 0; c < cols; c++) {
      if (c < leftSize) {
        left.push(normalized.seats[start + c]);
      } else {
        right.push(normalized.seats[start + c]);
      }
    }

    // Rotate left half non-empty students
    const leftNonEmpty = left.filter((s): s is string => s !== null);
    if (leftNonEmpty.length > 1) {
      const rotated = [...leftNonEmpty.slice(1), leftNonEmpty[0]];
      for (let i = 0; i < left.length; i++) {
        left[i] = i < rotated.length ? rotated[i] : null;
      }
    }

    // Rotate right half non-empty students
    const rightNonEmpty = right.filter((s): s is string => s !== null);
    if (rightNonEmpty.length > 1) {
      const rotated = [...rightNonEmpty.slice(1), rightNonEmpty[0]];
      for (let i = 0; i < right.length; i++) {
        right[i] = i < rotated.length ? rotated[i] : null;
      }
    }

    rotatedRows.push([...left, ...right]);
  }

  // Step 2: Row shift - row0->row2, row1->row0, row2->row1
  const shifted = [rotatedRows[1], rotatedRows[2], rotatedRows[0]];

  for (let row = 0; row < THREE_ROWS; row++) {
    for (let c = 0; c < cols; c++) {
      nextSeats[row * cols + c] = shifted[row][c];
    }
  }

  return {
    ...normalized,
    seats: nextSeats,
    rotationCount: normalized.rotationCount + 1,
  };
}

// --- Rotation: Arc ---

function rotateArcLayout(config: TimeModeConfig, students: Student[]): TimeModeConfig {
  const normalized = withLayout(config, 'ARC', students);
  const nextSeats = createEmptySeats(normalized.seats.length);

  for (let row = 0; row < ARC_ROWS; row++) {
    const start = row * ARC_COLS;
    const rowStudents: string[] = [];

    for (let col = 0; col < ARC_COLS; col++) {
      const id = normalized.seats[start + col];
      if (id) rowStudents.push(id);
    }

    if (rowStudents.length > 1) {
      const rotated = [...rowStudents.slice(1), rowStudents[0]];
      placeCentered(nextSeats, rotated, start, ARC_COLS);
    } else {
      placeCentered(nextSeats, rowStudents, start, ARC_COLS);
    }
  }

  return {
    ...normalized,
    seats: nextSeats,
    rotationCount: normalized.rotationCount + 1,
  };
}

// --- Three rows color order ---

/** Compute color order from rotation count. 6 positions: [row0-left, row0-right, row1-left, row1-right, row2-left, row2-right] */
export function getThreeRowsColorOrder(rotationCount: number): number[] {
  let order = [1, 2, 3, 4, 5, 6];
  const shifts = rotationCount % 3;

  for (let s = 0; s < shifts; s++) {
    order = [order[2], order[3], order[4], order[5], order[0], order[1]];
  }

  return order;
}

// --- Public API ---

export function createClassroom(name: string): Classroom {
  const defaultConfig = createEmptyConfig('GROUPS', 0);

  return {
    id: createId(),
    name,
    students: [],
    campus: '',
    building: '',
    room: '',
    sideNotes: '',
    updatedAt: now(),
    weekday: { ...defaultConfig },
    weekend: { ...defaultConfig },
  };
}

export function parseStudentNames(input: string): string[] {
  const lines = input.replace(/\r/g, '\n').split('\n');
  const names: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const firstCell = line.split(/[\t,，;；]/)[0]?.trim();
    if (!firstCell) {
      continue;
    }

    const normalized = firstCell.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      continue;
    }

    const lowered = normalized.toLowerCase();
    if (normalized === '姓名' || lowered === 'name' || lowered === 'student') {
      continue;
    }

    if (!seen.has(normalized)) {
      names.push(normalized);
      seen.add(normalized);
    }
  }

  return names;
}

export function replaceStudents(
  classroom: Classroom,
  names: string[],
  timeMode: TimeMode,
): Classroom {
  const sanitizedNames = uniqueNames(names).slice(0, MAX_STUDENTS);
  const students: Student[] = sanitizedNames.map((name) => ({ id: createId(), name }));
  const config = classroom[timeMode];
  const metrics = getLayoutMetrics(config.layoutMode, students.length);
  const seats = buildSeatsFromOrder(students.map((s) => s.id), metrics.capacity);

  return {
    ...classroom,
    students,
    [timeMode]: {
      ...config,
      rows: metrics.rows,
      cols: metrics.cols,
      seats,
      rotationCount: 0,
    },
    updatedAt: now(),
  };
}

export function changeLayoutMode(
  classroom: Classroom,
  layoutMode: LayoutMode,
  timeMode: TimeMode,
): Classroom {
  const config = classroom[timeMode];
  const nextConfig = withLayout(config, layoutMode, classroom.students);

  return {
    ...classroom,
    [timeMode]: nextConfig,
    updatedAt: now(),
  };
}

export function normalizeClassroomLayout(classroom: Classroom, timeMode: TimeMode): Classroom {
  const config = classroom[timeMode];
  const nextConfig = withLayout(config, config.layoutMode, classroom.students);

  return {
    ...classroom,
    [timeMode]: nextConfig,
  };
}

export function swapSeatAssignments(
  classroom: Classroom,
  first: number,
  second: number,
  timeMode: TimeMode,
): Classroom {
  const config = classroom[timeMode];

  if (first === second || first < 0 || second < 0 || first >= config.seats.length || second >= config.seats.length) {
    return classroom;
  }

  const seats = [...config.seats];
  [seats[first], seats[second]] = [seats[second], seats[first]];

  return {
    ...classroom,
    [timeMode]: { ...config, seats },
    updatedAt: now(),
  };
}

export function clearSeat(classroom: Classroom, seatIndex: number, timeMode: TimeMode): Classroom {
  const config = classroom[timeMode];

  if (seatIndex < 0 || seatIndex >= config.seats.length) {
    return classroom;
  }

  const seats = [...config.seats];
  seats[seatIndex] = null;

  return {
    ...classroom,
    [timeMode]: { ...config, seats },
    updatedAt: now(),
  };
}

export function placeStudentInSeat(
  classroom: Classroom,
  studentId: string,
  seatIndex: number,
  timeMode: TimeMode,
): Classroom {
  const config = classroom[timeMode];

  if (seatIndex < 0 || seatIndex >= config.seats.length) {
    return classroom;
  }

  if (!classroom.students.some((student) => student.id === studentId)) {
    return classroom;
  }

  const seats = config.seats.map((seat) => (seat === studentId ? null : seat));
  seats[seatIndex] = studentId;

  return {
    ...classroom,
    [timeMode]: { ...config, seats },
    updatedAt: now(),
  };
}

export function rotateSeatsOnce(classroom: Classroom, timeMode: TimeMode): Classroom {
  const config = classroom[timeMode];

  if (getAssignedCount(config) <= 1) {
    return classroom;
  }

  let nextConfig: TimeModeConfig;

  if (config.layoutMode === 'THREE_ROWS') {
    nextConfig = rotateThreeRows(config, classroom.students);
  } else if (config.layoutMode === 'ARC') {
    nextConfig = rotateArcLayout(config, classroom.students);
  } else {
    nextConfig = rotateGroupLayout(config, classroom.students);
  }

  return {
    ...classroom,
    [timeMode]: nextConfig,
    updatedAt: now(),
  };
}

export function randomizeSeats(classroom: Classroom, timeMode: TimeMode): Classroom {
  const config = classroom[timeMode];
  const normalized = withLayout(config, config.layoutMode, classroom.students);
  const randomizedIds = classroom.students.map((student) => student.id);

  for (let i = randomizedIds.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [randomizedIds[i], randomizedIds[randomIndex]] = [randomizedIds[randomIndex], randomizedIds[i]];
  }

  let nextSeats: Array<string | null>;

  if (config.layoutMode === 'ARC') {
    nextSeats = createEmptySeats(normalized.seats.length);
    const half = Math.ceil(randomizedIds.length / 2);
    placeCentered(nextSeats, randomizedIds.slice(0, half), 0, ARC_COLS);
    placeCentered(nextSeats, randomizedIds.slice(half), ARC_COLS, ARC_COLS);
  } else {
    nextSeats = buildSeatsFromOrder(randomizedIds, normalized.seats.length);
  }

  return {
    ...classroom,
    [timeMode]: {
      ...normalized,
      seats: nextSeats,
    },
    updatedAt: now(),
  };
}

export function getStudentMap(classroom: Classroom): Map<string, Student> {
  return new Map(classroom.students.map((student) => [student.id, student]));
}

export function getAssignedCount(config: TimeModeConfig): number {
  return config.seats.reduce((total, seat) => (seat ? total + 1 : total), 0);
}

export function getUnassignedStudents(classroom: Classroom, timeMode: TimeMode): Student[] {
  const config = classroom[timeMode];
  const assignedIds = new Set(config.seats.filter((seat): seat is string => Boolean(seat)));
  return classroom.students.filter((student) => !assignedIds.has(student.id));
}

export function sanitizeSize(value: number): number {
  return clampSize(value);
}
