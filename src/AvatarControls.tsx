import { useStudio } from './store';
import { controlsAt, defaults } from './motion';
import { useT } from './i18n';

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  onReset,
  unit = 'cm',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onReset: () => void;
  unit?: string;
}) {
  const t = useT();
  return (
    <div className="pose-adjustment">
      <div>
        <label>{label}</label>
        <output>
          {Math.round(value * (unit === 'cm' ? 100 : 1))}
          {unit}
        </output>
      </div>
      <div className="slider-input-row">
        <button
          type="button"
          className="reset-control"
          title={t('Reset')}
          aria-label={`${t('Reset')} ${label}`}
          onClick={onReset}
        >
          ↺
        </button>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

export function AvatarControls({
  collapsed,
  onCollapse,
}: {
  collapsed: boolean;
  onCollapse: () => void;
}) {
  const s = useStudio(),
    t = useT(),
    c = controlsAt(s.project, s.time);
  const names = {
    LeftFoot: 'Left foot',
    RightFoot: 'Right foot',
    LeftHand: 'Left hand',
    RightHand: 'Right hand',
  } as const;
  const key = (
    {
      LeftFoot: 'leftFoot',
      RightFoot: 'rightFoot',
      LeftHand: 'leftHand',
      RightHand: 'rightHand',
    } as const
  )[s.selected];
  const rotationKey = `${key}Rotation` as const,
    hand = key.includes('Hand');
  const setAxis = (index: number, value: number, rotation = false) => {
    const target = rotation ? rotationKey : key;
    const values = [...c[target]] as [number, number, number];
    values[index] = value;
    s.control({ [target]: values, ...(!rotation && hand ? { handIK: true } : {}) });
  };
  return (
    <aside className="right-panel panel avatar-adjustments" data-studio-tour="adjust">
      <div className="section-title avatar-panel-heading">
        <span className="avatar-panel-label">{t('AVATAR CONTROLS')}</span>
        <button
          type="button"
          className="collapse-controls"
          aria-label={t(collapsed ? 'Show avatar controls' : 'Hide avatar controls')}
          title={t(collapsed ? 'Show avatar controls' : 'Hide avatar controls')}
          aria-expanded={!collapsed}
          onClick={onCollapse}
        >
          {collapsed ? '❮' : '❯'}
        </button>
      </div>
      <div className="pose-adjustment-content">
        <p className="small subtle">{t('Choose a hand or foot. Adjust its position and angle.')}</p>
        <div className="limb-grid" role="group" aria-label={t('Choose a body part')}>
          {Object.entries(names).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={s.selected === id}
              className={s.selected === id ? 'active' : ''}
              onClick={() => s.set({ selected: id as typeof s.selected })}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <section className="pose-adjustment-section" aria-label={t(names[s.selected])}>
          <div className="control-heading">
            <strong>{t(names[s.selected])}</strong>
            <button
              title={t('Reset')}
              onClick={() => s.control({ [key]: [0, 0, 0], [rotationKey]: [0, 0, 0] })}
            >
              {t('Reset')}
            </button>
          </div>
          <div className="pose-section-label">{t('Position')}</div>
          {['Left / right', 'Down / up', 'Back / forward'].map((label, index) => (
            <Slider
              key={label}
              label={t(label)}
              value={c[key][index]}
              min={-0.5}
              max={0.5}
              step={0.005}
              onChange={(value) => setAxis(index, value)}
              onReset={() => setAxis(index, 0)}
            />
          ))}
          <details className="pose-angle-controls">
            <summary>{t('Angle')}</summary>
            {['Tilt', 'Turn', 'Roll'].map((label, index) => (
              <Slider
                key={label}
                label={t(label)}
                unit="°"
                value={(c[rotationKey][index] * 180) / Math.PI}
                min={-60}
                max={60}
                step={1}
                onChange={(value) => setAxis(index, (value * Math.PI) / 180, true)}
                onReset={() => setAxis(index, 0, true)}
              />
            ))}
          </details>
        </section>
        <section className="pose-adjustment-section" aria-label={t('Body and balance')}>
          <div className="pose-section-label">{t('Body and balance')}</div>
          <Slider
            label={t('Body height')}
            value={c.pelvis}
            min={-0.4}
            max={0.15}
            step={0.005}
            onChange={(pelvis) => s.control({ pelvis })}
            onReset={() => s.control({ pelvis: defaults.pelvis })}
          />
          <Slider
            label={t(hand ? 'Elbow bend' : 'Knee bend')}
            value={hand ? c.elbow - defaults.elbow : c.knee - defaults.knee}
            min={hand ? -0.5 : -0.3}
            max={hand ? 1.1 : 0.45}
            onChange={(value) =>
              s.control(
                hand
                  ? { elbow: defaults.elbow + value, handIK: true }
                  : { knee: defaults.knee + value },
              )
            }
            onReset={() => s.control(hand ? { elbow: defaults.elbow } : { knee: defaults.knee })}
          />
          <label className="pose-support-toggle">
            <input
              type="checkbox"
              aria-label={t('Correct foot contacts')}
              checked={c.ground}
              onChange={(e) => s.control({ ground: e.target.checked })}
            />
            <span>{t('Correct foot contacts')}</span>
          </label>
          <p className="small subtle">{t('Keeps support steady while preserving jumps.')}</p>
        </section>
        <button
          className="reset-all"
          onClick={() => s.change({ controls: structuredClone(defaults), keyframes: [] })}
        >
          {t('Reset all controls')}
        </button>
      </div>
    </aside>
  );
}
