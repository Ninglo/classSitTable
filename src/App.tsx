import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent } from 'react';
import './App.css';
import {
  MAX_STUDENTS,
  changeLayoutMode,
  clearSeat,
  createClassroom,
  getActiveGroupIndices,
  getAssignedCount,
  getGroupCountBySize,
  getLayoutMetrics,
  getRotationMapping,
  getStudentMap,
  getThreeRowsColorOrder,
  getUnassignedStudents,
  parseStudentNames,
  placeStudentInSeat,
  randomizeSeats,
  replaceStudents,
  rotateSeatsOnce,
  swapSeatAssignments,
} from './lib/classroom';
import { formatBackupFilename, loadState, parseBackup, saveState } from './lib/storage';
import type { AppState, Classroom, LayoutMode, TimeMode, TimeModeConfig } from './types';

const LAYOUT_OPTIONS: Array<{ mode: LayoutMode; label: string; hint: string }> = [
  {
    mode: 'GROUPS',
    label: '小组布局',
    hint: '自动使用 3-6 组，每组最多 6 人。',
  },
  {
    mode: 'THREE_ROWS',
    label: '三大横排',
    hint: '三排轮换，排内左右分组独立轮转。',
  },
  {
    mode: 'ARC',
    label: '圆弧布局',
    hint: '两排弧形，每排最多 18 人，居中排列。',
  },
];

const GROUP_COLORS = ['#f8e998', '#98c8f4', '#f6bc54', '#a6d8f4', '#b9e2be', '#f3c4d4'];

const GROUP_ROW_LAYOUT: Record<number, number[][]> = {
  3: [[0, 1, 2]],
  4: [[0, 1, 2], [4]],
  5: [[0, 1, 2], [3, 4]],
  6: [[0, 1, 2], [3, 4, 5]],
};

const ARC_COLS = 18;

function formatDatetime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function getGroupRows(groupCount: number): number[][] {
  return GROUP_ROW_LAYOUT[groupCount] ?? GROUP_ROW_LAYOUT[6];
}

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [newClassName, setNewClassName] = useState('');
  const [layoutDraftByClassroomId, setLayoutDraftByClassroomId] = useState<Record<string, LayoutMode>>({});
  const [importText, setImportText] = useState('');
  const [importLayout, setImportLayout] = useState<LayoutMode>('GROUPS');
  const [importHint, setImportHint] = useState('');
  const [selectedSeatIndex, setSelectedSeatIndex] = useState<number | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showBatchImport, setShowBatchImport] = useState(false);
  const [batchImportText, setBatchImportText] = useState('');
  const [batchImportHint, setBatchImportHint] = useState('');

  const studentFileInputRef = useRef<HTMLInputElement | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTimeMode = state.activeTimeMode;

  const activeClassroom = useMemo(
    () => state.classrooms.find((classroom) => classroom.id === state.activeClassroomId) ?? null,
    [state.activeClassroomId, state.classrooms],
  );

  const activeConfig: TimeModeConfig | null = useMemo(() => {
    if (!activeClassroom) return null;
    return activeClassroom[activeTimeMode];
  }, [activeClassroom, activeTimeMode]);

  const studentMap = useMemo(() => {
    if (!activeClassroom) return new Map();
    return getStudentMap(activeClassroom);
  }, [activeClassroom]);

  const unassignedStudents = useMemo(() => {
    if (!activeClassroom) return [];
    return getUnassignedStudents(activeClassroom, activeTimeMode);
  }, [activeClassroom, activeTimeMode]);

  const assignedCount = activeConfig ? getAssignedCount(activeConfig) : 0;
  const capacity = activeConfig ? activeConfig.seats.length : 0;
  const layoutDraft: LayoutMode = activeClassroom
    ? layoutDraftByClassroomId[activeClassroom.id] ?? activeConfig?.layoutMode ?? 'GROUPS'
    : 'GROUPS';

  useEffect(() => {
    saveState(state);
  }, [state]);

  // F2 key toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setControlsVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function setActiveTimeMode(mode: TimeMode) {
    setState((prev) => ({ ...prev, activeTimeMode: mode }));
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
  }

  function updateClassroom(classroomId: string, updater: (classroom: Classroom) => Classroom) {
    setState((previous) => ({
      ...previous,
      classrooms: previous.classrooms.map((classroom) =>
        classroom.id === classroomId ? updater(classroom) : classroom,
      ),
    }));
  }

  function handleCreateClassroom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newClassName.trim();
    if (!name) return;

    const classroom = createClassroom(name);
    setState((previous) => ({
      ...previous,
      classrooms: [...previous.classrooms, classroom],
      activeClassroomId: classroom.id,
    }));
    setLayoutDraftByClassroomId((previous) => ({
      ...previous,
      [classroom.id]: classroom.weekday.layoutMode,
    }));
    setNewClassName('');
    setImportHint('');
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
  }

  function handleDeleteClassroom(classroomId: string) {
    const target = state.classrooms.find((classroom) => classroom.id === classroomId);
    if (!target) return;
    const ok = window.confirm(`确认删除班级「${target.name}」？该班级数据会从当前浏览器移除。`);
    if (!ok) return;

    setState((previous) => {
      const classrooms = previous.classrooms.filter((classroom) => classroom.id !== classroomId);
      const nextActiveClassroomId =
        previous.activeClassroomId === classroomId
          ? classrooms[0]?.id ?? null
          : previous.activeClassroomId;
      return { ...previous, classrooms, activeClassroomId: nextActiveClassroomId };
    });
    setLayoutDraftByClassroomId((previous) => {
      const next = { ...previous };
      delete next[classroomId];
      return next;
    });
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
  }

  function importStudentsFromText(rawText: string) {
    if (!activeClassroom) return;
    const names = parseStudentNames(rawText);
    if (names.length === 0) {
      setImportHint('没有识别到学生姓名，请检查格式。');
      return;
    }
    const trimmedNames = names.slice(0, MAX_STUDENTS);
    updateClassroom(activeClassroom.id, (classroom) => {
      const replaced = replaceStudents(classroom, trimmedNames, activeTimeMode);
      // Apply the selected import layout
      return changeLayoutMode(replaced, importLayout, activeTimeMode);
    });
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
    if (names.length > MAX_STUDENTS) {
      setImportHint(`导入 ${MAX_STUDENTS} 人（${renderLayoutName(importLayout)}），超出上限 ${names.length - MAX_STUDENTS} 人已忽略。`);
      return;
    }
    setImportHint(`导入成功，共 ${trimmedNames.length} 人（${renderLayoutName(importLayout)}）。`);
  }

  async function handleStudentFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    importStudentsFromText(text);
    event.target.value = '';
  }

  async function handleBackupFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsedState = parseBackup(text);
    if (!parsedState) {
      setImportHint('备份文件格式不正确，导入失败。');
      event.target.value = '';
      return;
    }
    setState(parsedState);
    setLayoutDraftByClassroomId({});
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
    setImportHint('备份已恢复。');
    event.target.value = '';
  }

  function handleSeatClick(seatIndex: number) {
    if (!activeClassroom) return;
    if (isEditMode) return; // In edit mode, clicks don't swap

    if (selectedStudentId) {
      updateClassroom(activeClassroom.id, (classroom) =>
        placeStudentInSeat(classroom, selectedStudentId, seatIndex, activeTimeMode),
      );
      setSelectedStudentId(null);
      setSelectedSeatIndex(null);
      return;
    }
    if (selectedSeatIndex === null) {
      setSelectedSeatIndex(seatIndex);
      return;
    }
    if (selectedSeatIndex === seatIndex) {
      setSelectedSeatIndex(null);
      return;
    }
    updateClassroom(activeClassroom.id, (classroom) =>
      swapSeatAssignments(classroom, selectedSeatIndex, seatIndex, activeTimeMode),
    );
    setSelectedSeatIndex(null);
  }

  function handleEditSeatName(seatIndex: number, newName: string) {
    if (!activeClassroom || !activeConfig) return;
    const studentId = activeConfig.seats[seatIndex];
    if (!studentId) return;

    updateClassroom(activeClassroom.id, (classroom) => ({
      ...classroom,
      students: classroom.students.map((s) =>
        s.id === studentId ? { ...s, name: newName } : s,
      ),
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleApplyLayout() {
    if (!activeClassroom) return;
    updateClassroom(activeClassroom.id, (classroom) => changeLayoutMode(classroom, layoutDraft, activeTimeMode));
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
    setImportHint('布局已更新。');
  }

  function handleExportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = formatBackupFilename();
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleMetaChange(
    field: 'campus' | 'building' | 'room' | 'sideNotes',
    value: string,
  ) {
    if (!activeClassroom) return;
    updateClassroom(activeClassroom.id, (classroom) => ({
      ...classroom,
      [field]: value,
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleConfigMetaChange(
    field: 'weekLabel' | 'classTime',
    value: string,
  ) {
    if (!activeClassroom || !activeConfig) return;
    updateClassroom(activeClassroom.id, (classroom) => ({
      ...classroom,
      [activeTimeMode]: { ...classroom[activeTimeMode], [field]: value },
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleNameChange(newName: string) {
    if (!activeClassroom) return;
    updateClassroom(activeClassroom.id, (classroom) => ({
      ...classroom,
      name: newName,
      updatedAt: new Date().toISOString(),
    }));
  }

  function resetCurrentSelection() {
    setSelectedSeatIndex(null);
    setSelectedStudentId(null);
  }

  function handlePrint() {
    window.print();
  }

  function handleBatchImport() {
    const classes = batchImportText.split('!').filter((c) => c.trim());
    if (classes.length === 0) {
      setBatchImportHint('未检测到班级数据，请检查格式。');
      return;
    }

    let successCount = 0;
    const errors: string[] = [];
    const newClassrooms: Classroom[] = [];

    for (const classText of classes) {
      try {
        const lines = classText.split('\n').map((l) => l.trim()).filter((l) => l);
        let className = '';
        let campus = '';
        let building = '';
        let room = '';
        let currentTimeMode: 'weekday' | 'weekend' | '' = '';

        const timeModes: Record<'weekday' | 'weekend', {
          layout: LayoutMode;
          classTime: string;
          names: string[];
          hasConfig: boolean;
        }> = {
          weekday: { layout: 'GROUPS', classTime: '', names: [], hasConfig: false },
          weekend: { layout: 'GROUPS', classTime: '', names: [], hasConfig: false },
        };

        for (const line of lines) {
          if (line.startsWith('班级名称:') || line.startsWith('班级名称：')) {
            className = line.substring(line.indexOf(':') + 1).trim() || line.substring(line.indexOf('：') + 1).trim();
          } else if (line.startsWith('校区:') || line.startsWith('校区：')) {
            campus = line.substring(line.indexOf(':') + 1).trim() || line.substring(line.indexOf('：') + 1).trim();
          } else if (line.startsWith('楼层:') || line.startsWith('楼层：')) {
            building = line.substring(line.indexOf(':') + 1).trim() || line.substring(line.indexOf('：') + 1).trim();
          } else if (line.startsWith('教室:') || line.startsWith('教室：')) {
            room = line.substring(line.indexOf(':') + 1).trim() || line.substring(line.indexOf('：') + 1).trim();
          } else if (line.startsWith('周中布局:') || line.startsWith('周中布局：')) {
            const layoutStr = line.substring(line.indexOf(':') + 1).trim() || line.substring(line.indexOf('：') + 1).trim();
            timeModes.weekday.layout = layoutStr === '三排' ? 'THREE_ROWS' : layoutStr === '圆弧' ? 'ARC' : 'GROUPS';
            timeModes.weekday.hasConfig = true;
            currentTimeMode = 'weekday';
          } else if (line.startsWith('周末布局:') || line.startsWith('周末布局：')) {
            const layoutStr = line.substring(line.indexOf(':') + 1).trim() || line.substring(line.indexOf('：') + 1).trim();
            timeModes.weekend.layout = layoutStr === '三排' ? 'THREE_ROWS' : layoutStr === '圆弧' ? 'ARC' : 'GROUPS';
            timeModes.weekend.hasConfig = true;
            currentTimeMode = 'weekend';
          } else if (line.startsWith('时间:') || line.startsWith('时间：')) {
            if (currentTimeMode) {
              timeModes[currentTimeMode].classTime = line.substring(line.indexOf(':') + 1).trim();
            }
          } else if (currentTimeMode && line.match(/^Group\s+\d+/i)) {
            const studentsStr = line.substring(line.indexOf(':') + 1);
            const students = studentsStr.split(',').map((s) => s.trim()).filter((s) => s);
            timeModes[currentTimeMode].names.push(...students);
          }
        }

        if (!className) {
          throw new Error('缺少班级名称');
        }
        if (!timeModes.weekday.hasConfig && !timeModes.weekend.hasConfig) {
          throw new Error('至少需要一个布局配置');
        }

        // Merge all unique names from both modes
        const allNames = [...new Set([...timeModes.weekday.names, ...timeModes.weekend.names])];
        const classroom = createClassroom(className);
        let updated: Classroom = {
          ...classroom,
          campus,
          building,
          room,
        };

        // Apply students + layout for weekday
        if (timeModes.weekday.hasConfig && allNames.length > 0) {
          updated = replaceStudents(updated, allNames, 'weekday');
          updated = changeLayoutMode(updated, timeModes.weekday.layout, 'weekday');
          updated = {
            ...updated,
            weekday: { ...updated.weekday, classTime: timeModes.weekday.classTime },
          };
        }

        // Apply students + layout for weekend
        if (timeModes.weekend.hasConfig && allNames.length > 0) {
          // Students are shared, so weekend already has them from weekday replaceStudents
          updated = changeLayoutMode(updated, timeModes.weekend.layout, 'weekend');
          // Also place students for weekend
          const weekendConfig = updated.weekend;
          const studentIds = updated.students.map((s) => s.id);
          const metrics = getLayoutMetrics(timeModes.weekend.layout, studentIds.length);
          const seats = Array.from({ length: metrics.capacity }, (_, i) =>
            i < studentIds.length ? studentIds[i] : null,
          );
          updated = {
            ...updated,
            weekend: { ...weekendConfig, seats, classTime: timeModes.weekend.classTime },
          };
        } else if (!timeModes.weekend.hasConfig && allNames.length > 0) {
          // Default weekend to same as weekday
          updated = replaceStudents(updated, allNames, 'weekend');
        }

        newClassrooms.push(updated);
        successCount++;
      } catch (e) {
        const name = classText.split('\n')[0]?.split(':')[1]?.trim() || '未知';
        errors.push(`${name}: ${e instanceof Error ? e.message : '未知错误'}`);
      }
    }

    if (newClassrooms.length > 0) {
      setState((prev) => ({
        ...prev,
        classrooms: [...prev.classrooms, ...newClassrooms],
        activeClassroomId: newClassrooms[0].id,
      }));
    }

    if (errors.length > 0) {
      setBatchImportHint(`成功导入 ${successCount} 个班级，${errors.length} 个失败：${errors.join('；')}`);
    } else {
      setBatchImportHint(`成功导入 ${successCount} 个班级！`);
      setTimeout(() => setShowBatchImport(false), 1500);
    }
  }

  // --- Render helpers ---

  function renderSeat(seatIndex: number, label: string, fontSize?: number) {
    if (!activeClassroom || !activeConfig) return null;

    const studentId = activeConfig.seats[seatIndex];
    const studentName = studentId ? studentMap.get(studentId)?.name ?? '未知学生' : '空位';

    if (isEditMode && studentId) {
      return (
        <div
          key={`${activeClassroom.id}-seat-${seatIndex}`}
          className={`seat-card filled editing`}
        >
          <span className="seat-card-label">{label}</span>
          <input
            className="seat-edit-input"
            type="text"
            value={studentName}
            onChange={(e) => handleEditSeatName(seatIndex, e.target.value)}
            style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
          />
        </div>
      );
    }

    return (
      <button
        key={`${activeClassroom.id}-seat-${seatIndex}`}
        type="button"
        className={`seat-card ${studentId ? 'filled' : 'empty'} ${selectedSeatIndex === seatIndex ? 'selected' : ''}`}
        onClick={() => handleSeatClick(seatIndex)}
      >
        <span className="seat-card-label">{label}</span>
        <span className="seat-card-name" style={fontSize ? { fontSize: `${fontSize}px` } : undefined}>
          {studentName}
        </span>
      </button>
    );
  }

  function renderThreeRowsLayout(classroom: Classroom) {
    const config = classroom[activeTimeMode];
    const metrics = getLayoutMetrics('THREE_ROWS', classroom.students.length);
    const cols = metrics.cols;
    const leftSize = Math.ceil(cols / 2);
    const rightSize = cols - leftSize;
    const colorOrder = getThreeRowsColorOrder(config.rotationCount);
    const rowNames = ['第一排', '第二排', '第三排'];

    return (
      <div className="three-rows-layout">
        {[0, 1, 2].map((row) => {
          const leftColorIdx = colorOrder[row * 2] - 1;
          const rightColorIdx = colorOrder[row * 2 + 1] - 1;
          const leftBg = GROUP_COLORS[leftColorIdx % GROUP_COLORS.length];
          const rightBg = GROUP_COLORS[rightColorIdx % GROUP_COLORS.length];

          // Compute dynamic font size for this row
          let maxLen = 1;
          for (let c = 0; c < cols; c++) {
            const idx = row * cols + c;
            const sid = config.seats[idx];
            if (sid) {
              const name = studentMap.get(sid)?.name ?? '';
              if (name.length > maxLen) maxLen = name.length;
            }
          }
          const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLen)));

          return (
            <section key={`${classroom.id}-row-${row}`} className="row-strip">
              <div className="row-strip-inner">
                <div className="row-label-vertical">{rowNames[row]}</div>
                <div className="row-strip-table">
                  {/* Left group */}
                  <div className="row-half" style={{ '--half-bg': leftBg } as CSSProperties}>
                    <div className="row-half-header">
                      {Array.from({ length: leftSize }, (_, i) => (
                        <span key={`lh-${i}`}>左{i + 1}</span>
                      ))}
                    </div>
                    <div className="row-half-seats" style={{ gridTemplateColumns: `repeat(${leftSize}, minmax(60px, 1fr))` }}>
                      {Array.from({ length: leftSize }, (_, c) => {
                        const seatIndex = row * cols + c;
                        return renderSeat(seatIndex, `左${c + 1}`, fontSize);
                      })}
                    </div>
                  </div>
                  {/* Gap */}
                  <div className="row-gap" />
                  {/* Right group (displayed in reverse: 右N, 右N-1, ..., 右1) */}
                  <div className="row-half" style={{ '--half-bg': rightBg } as CSSProperties}>
                    <div className="row-half-header">
                      {Array.from({ length: rightSize }, (_, i) => (
                        <span key={`rh-${i}`}>右{rightSize - i}</span>
                      ))}
                    </div>
                    <div className="row-half-seats" style={{ gridTemplateColumns: `repeat(${rightSize}, minmax(60px, 1fr))` }}>
                      {Array.from({ length: rightSize }, (_, i) => {
                        // Reverse order display: index 0 shows rightmost seat
                        const c = leftSize + (rightSize - 1 - i);
                        const seatIndex = row * cols + c;
                        return renderSeat(seatIndex, `右${rightSize - i}`, fontSize);
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  function renderGroupLayout(classroom: Classroom) {
    const config = classroom[activeTimeMode];
    const metrics = getLayoutMetrics('GROUPS', classroom.students.length);
    const mapping = getRotationMapping(metrics.groupCount, config.rotationCount);

    return (
      <div className="group-layout">
        {getGroupRows(metrics.groupCount).map((row, rowIndex) => (
          <div key={`${classroom.id}-g-row-${rowIndex}`} className="group-row-grid">
            {row.map((tableIndex) => {
              const groupIndex = mapping[tableIndex];

              // Dynamic font size for this group
              let maxLen = 1;
              for (let s = 0; s < 6; s++) {
                const seatIdx = groupIndex * 6 + s;
                const sid = config.seats[seatIdx];
                if (sid) {
                  const name = studentMap.get(sid)?.name ?? '';
                  if (name.length > maxLen) maxLen = name.length;
                }
              }
              const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLen)));

              const customStyle: CSSProperties = {
                '--group-color': GROUP_COLORS[groupIndex % GROUP_COLORS.length],
                ...(row.length === 1 ? { gridColumn: '2 / span 1' } : null),
              } as CSSProperties;

              return (
                <section
                  key={`${classroom.id}-group-${tableIndex}`}
                  className="group-card"
                  style={customStyle}
                >
                  <h3>Group {tableIndex + 1}</h3>
                  <div className="group-seat-grid">
                    {Array.from({ length: 6 }, (_, seatInGroup) => {
                      const seatIndex = groupIndex * 6 + seatInGroup;
                      const rowNo = Math.floor(seatInGroup / 2) + 1;
                      const colNo = (seatInGroup % 2) + 1;
                      return renderSeat(seatIndex, `R${rowNo}-${colNo}`, fontSize);
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  function renderArcLayout(classroom: Classroom) {
    const config = classroom[activeTimeMode];
    const arcColors = ['#f8e998', '#98c8f4'];

    return (
      <div className="arc-layout">
        {[0, 1].map((rowIdx) => {
          const start = rowIdx * ARC_COLS;
          const center = (ARC_COLS - 1) / 2;
          const maxOffset = 20;

          // Dynamic font size for this row
          let maxLen = 1;
          for (let i = 0; i < ARC_COLS; i++) {
            const sid = config.seats[start + i];
            if (sid) {
              const name = studentMap.get(sid)?.name ?? '';
              if (name.length > maxLen) maxLen = name.length;
            }
          }
          const fontSize = Math.min(16, Math.max(12, Math.floor(140 / maxLen)));

          return (
            <div
              key={`${classroom.id}-arc-${rowIdx}`}
              className="arc-row"
              style={{ background: arcColors[rowIdx % arcColors.length] }}
            >
              <div className="arc-seats">
                {Array.from({ length: ARC_COLS }, (_, i) => {
                  const seatIndex = start + i;
                  const distance = Math.abs(i - center);
                  const upward = distance <= center
                    ? Math.round(Math.sqrt(center * center - distance * distance) * (maxOffset / center))
                    : 0;

                  return (
                    <div
                      key={`arc-seat-${seatIndex}`}
                      className="arc-seat-wrapper"
                      style={{ marginBottom: `${upward}px` }}
                    >
                      {renderSeat(seatIndex, `${i + 1}`, fontSize)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderLayoutName(mode: LayoutMode): string {
    if (mode === 'GROUPS') return '小组布局';
    if (mode === 'THREE_ROWS') return '三大横排';
    return '圆弧布局';
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>在线班级座位表</h1>
          <p>多班级独立管理，一键轮换后可直接打印或发给家长与学生。</p>
        </div>
        <div className="header-actions no-print" style={controlsVisible ? undefined : { display: 'none' }}>
          <button type="button" className="btn-secondary" onClick={() => setShowBatchImport(true)}>
            批量导入
          </button>
          <button type="button" className="btn-secondary" onClick={handleExportBackup}>
            导出备份
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => backupFileInputRef.current?.click()}
          >
            导入备份
          </button>
          <input
            ref={backupFileInputRef}
            type="file"
            accept="application/json"
            className="hidden-input"
            onChange={handleBackupFileChange}
          />
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="control-panel card no-print" style={controlsVisible ? undefined : { display: 'none' }}>
          <section>
            <h2>班级管理</h2>
            <form className="create-form" onSubmit={handleCreateClassroom}>
              <input
                type="text"
                placeholder="例如：J328 班"
                value={newClassName}
                onChange={(event) => setNewClassName(event.target.value)}
                maxLength={30}
                required
              />
              <button type="submit" className="btn-primary">
                新建班级
              </button>
            </form>
          </section>

          <section>
            <h3>已创建班级</h3>
            {state.classrooms.length === 0 ? (
              <p className="empty-tip">还没有班级，先创建一个。</p>
            ) : (
              <ul className="class-list">
                {state.classrooms.map((classroom) => (
                  <li key={classroom.id} className={classroom.id === state.activeClassroomId ? 'active' : ''}>
                    <button
                      type="button"
                      className="class-select"
                      onClick={() => {
                        setState((previous) => ({ ...previous, activeClassroomId: classroom.id }));
                        setSelectedSeatIndex(null);
                        setSelectedStudentId(null);
                      }}
                    >
                      <span>{classroom.name}</span>
                      <small>
                        {classroom.students.length} 人 / {classroom[activeTimeMode].seats.length} 座
                      </small>
                    </button>
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => handleDeleteClassroom(classroom.id)}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Weekday/Weekend toggle */}
          <section>
            <h3>时间模式</h3>
            <div className="time-toggle">
              <button
                type="button"
                className={`toggle-btn ${activeTimeMode === 'weekday' ? 'active' : ''}`}
                onClick={() => setActiveTimeMode('weekday')}
              >
                周中
              </button>
              <button
                type="button"
                className={`toggle-btn ${activeTimeMode === 'weekend' ? 'active' : ''}`}
                onClick={() => setActiveTimeMode('weekend')}
              >
                周末
              </button>
            </div>
          </section>

          <section>
            <h3>导入学生名单</h3>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'支持粘贴 CSV 或每行一个姓名\n例：\nName\nAlice\nBob'}
              rows={8}
            />
            <div className="import-layout-picker">
              <span>导入布局：</span>
              {LAYOUT_OPTIONS.map((option) => (
                <label key={`import-${option.mode}`} className="import-layout-radio">
                  <input
                    type="radio"
                    name="import-layout"
                    value={option.mode}
                    checked={importLayout === option.mode}
                    onChange={() => setImportLayout(option.mode)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => importStudentsFromText(importText)}
                disabled={!activeClassroom}
              >
                覆盖导入
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => studentFileInputRef.current?.click()}
                disabled={!activeClassroom}
              >
                读取文件
              </button>
              <input
                ref={studentFileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden-input"
                onChange={handleStudentFileChange}
              />
            </div>
            {importHint ? <p className="status-tip">{importHint}</p> : null}
          </section>

          <section>
            <h3>布局模式</h3>
            <div className="layout-picker">
              {LAYOUT_OPTIONS.map((option) => (
                <label key={option.mode} className="layout-option">
                  <input
                    type="radio"
                    name="layout-mode"
                    value={option.mode}
                    checked={layoutDraft === option.mode}
                    onChange={() => {
                      if (!activeClassroom) return;
                      setLayoutDraftByClassroomId((previous) => ({
                        ...previous,
                        [activeClassroom.id]: option.mode,
                      }));
                    }}
                    disabled={!activeClassroom}
                  />
                  <div>
                    <strong>{option.label}</strong>
                    <small>{option.hint}</small>
                  </div>
                </label>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleApplyLayout}
              disabled={!activeClassroom}
            >
              应用布局
            </button>
            <p className="rule-tip">
              小组布局人数规则：1-18 人 3 组，19-24 人 4 组（1,2,3,5），25-30 人 5 组，31-36 人 6 组。
            </p>
          </section>
        </aside>

        <section className="worksheet card">
          {!activeClassroom || !activeConfig ? (
            <div className="board-empty">
              <h2>先创建班级再开始排座</h2>
              <p>创建后导入学生名单，选择布局并点击下一次轮换。</p>
            </div>
          ) : (
            <>
              <div className="worksheet-header">
                <div>
                  <h2>
                    <input
                      className="header-name-input"
                      type="text"
                      value={activeClassroom.name}
                      onChange={(e) => handleNameChange(e.target.value)}
                    />
                    班座位表
                  </h2>
                  <p>上次更新：{formatDatetime(activeClassroom.updatedAt)}</p>
                </div>
                <div className="board-stats">
                  <span>学生 {activeClassroom.students.length}</span>
                  <span>已入座 {assignedCount}</span>
                  <span>容量 {capacity}</span>
                  <span>轮换 {activeConfig.rotationCount}</span>
                  <span>{activeTimeMode === 'weekday' ? '周中' : '周末'}</span>
                </div>
              </div>

              <div className="meta-grid">
                <label>
                  <span>周次</span>
                  <input
                    value={activeConfig.weekLabel}
                    onChange={(event) => handleConfigMetaChange('weekLabel', event.target.value)}
                    placeholder="例如：第 6 周"
                  />
                </label>
                <label>
                  <span>上课时间</span>
                  <input
                    value={activeConfig.classTime}
                    onChange={(event) => handleConfigMetaChange('classTime', event.target.value)}
                    placeholder="例如：周三 19:00-21:00"
                  />
                </label>
                <label>
                  <span>校区</span>
                  <select
                    value={activeClassroom.campus}
                    onChange={(event) => handleMetaChange('campus', event.target.value)}
                  >
                    <option value="">选择校区</option>
                    <option value="C86校区">C86校区</option>
                    <option value="七彩校区">七彩校区</option>
                  </select>
                </label>
                <label>
                  <span>楼栋</span>
                  <input
                    value={activeClassroom.building}
                    onChange={(event) => handleMetaChange('building', event.target.value)}
                    placeholder="例如：1 楼"
                  />
                </label>
                <label>
                  <span>教室</span>
                  <input
                    value={activeClassroom.room}
                    onChange={(event) => handleMetaChange('room', event.target.value)}
                    placeholder="例如：205"
                  />
                </label>
                <label>
                  <span>布局</span>
                  <input value={renderLayoutName(activeConfig.layoutMode)} readOnly />
                </label>
              </div>

              <div className="screen-banner">屏幕 & 白板</div>

              <div className="worksheet-main">
                <div className="seat-stage">
                  {activeConfig.layoutMode === 'GROUPS'
                    ? renderGroupLayout(activeClassroom)
                    : activeConfig.layoutMode === 'ARC'
                      ? renderArcLayout(activeClassroom)
                      : renderThreeRowsLayout(activeClassroom)}
                </div>

                <aside className="notes-panel">
                  <h3>课堂备注</h3>
                  <textarea
                    value={activeClassroom.sideNotes}
                    onChange={(event) => handleMetaChange('sideNotes', event.target.value)}
                    placeholder="可填写课堂目标、作业提醒、家长须知等。"
                    rows={14}
                  />

                  <section className="unassigned-box">
                    <h4>未入座学生 ({unassignedStudents.length})</h4>
                    {unassignedStudents.length === 0 ? (
                      <p className="empty-tip">全部已入座</p>
                    ) : (
                      <div className="student-tags">
                        {unassignedStudents.map((student) => (
                          <button
                            key={student.id}
                            type="button"
                            className={selectedStudentId === student.id ? 'tag selected' : 'tag'}
                            onClick={() => {
                              setSelectedSeatIndex(null);
                              setSelectedStudentId((current) => (current === student.id ? null : student.id));
                            }}
                          >
                            {student.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </aside>
              </div>

              <div className="worksheet-actions no-print" style={controlsVisible ? undefined : { display: 'none' }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => updateClassroom(activeClassroom.id, (classroom) => rotateSeatsOnce(classroom, activeTimeMode))}
                  disabled={assignedCount <= 1}
                >
                  下一次轮换
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => updateClassroom(activeClassroom.id, (classroom) => randomizeSeats(classroom, activeTimeMode))}
                >
                  随机排座
                </button>
                <button
                  type="button"
                  className={`btn-secondary ${isEditMode ? 'btn-danger' : ''}`}
                  onClick={() => {
                    setIsEditMode((v) => !v);
                    resetCurrentSelection();
                  }}
                >
                  {isEditMode ? '退出编辑' : '编辑模式'}
                </button>
                <button type="button" className="btn-secondary" onClick={resetCurrentSelection}>
                  取消选择
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (selectedSeatIndex === null) return;
                    updateClassroom(activeClassroom.id, (classroom) => clearSeat(classroom, selectedSeatIndex, activeTimeMode));
                    setSelectedSeatIndex(null);
                  }}
                  disabled={selectedSeatIndex === null}
                >
                  清空选中座位
                </button>
                <button type="button" className="btn-secondary" onClick={handlePrint}>
                  打印分享版
                </button>
              </div>

              <p className="f2-hint no-print" style={controlsVisible ? undefined : { display: 'none' }}>
                按 F2 键隐藏/显示控件
              </p>
            </>
          )}
        </section>
      </main>

      {showBatchImport && (
        <div className="modal-overlay" onClick={() => setShowBatchImport(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>批量导入班级配置</h2>
            <p className="modal-hint">按以下格式输入数据，使用 <code>!</code> 分隔多个班级：</p>
            <pre className="format-example">{`班级名称: J328
校区: C86校区
楼层: 1
教室: 101
周中布局: 圆桌
时间: 周三 19:00-21:00
Group 1: Alice, Bob, Carol
Group 2: David, Eve, Frank
!
班级名称: J329
校区: 七彩校区
楼层: 2
教室: 205
周中布局: 三排
Group 1: Grace, Heidi, Ivan
Group 2: Judy, Kevin, Leo`}</pre>
            <textarea
              className="batch-textarea"
              value={batchImportText}
              onChange={(e) => setBatchImportText(e.target.value)}
              placeholder="在此输入数据..."
              rows={12}
            />
            {batchImportHint && <p className="status-tip">{batchImportHint}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowBatchImport(false)}>
                取消
              </button>
              <button type="button" className="btn-primary" onClick={handleBatchImport}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
