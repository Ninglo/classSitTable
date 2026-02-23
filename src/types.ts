export type LayoutMode = 'THREE_ROWS' | 'GROUPS' | 'ARC';

export type TimeMode = 'weekday' | 'weekend';

export interface Student {
  id: string;
  name: string;
}

export interface TimeModeConfig {
  layoutMode: LayoutMode;
  rows: number;
  cols: number;
  seats: Array<string | null>;
  rotationCount: number;
  weekLabel: string;
  classTime: string;
}

export interface Classroom {
  id: string;
  name: string;
  students: Student[];
  campus: string;
  building: string;
  room: string;
  sideNotes: string;
  updatedAt: string;
  weekday: TimeModeConfig;
  weekend: TimeModeConfig;
}

export interface AppState {
  version: number;
  classrooms: Classroom[];
  activeClassroomId: string | null;
  activeTimeMode: TimeMode;
}
