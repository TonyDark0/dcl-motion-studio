import { useEffect, useRef, useState } from 'react';
import './image-poses.css';
import { Button, Modal } from './ui';
import { useT } from './i18n';
import { POSE_EDGES, type PoseReferences, type ReviewedImage } from './pose-reference';
import { captureImagePose, moveImagePoint } from './image-pose-capture';
import { fitImagePose } from './image-pose-solver';
import { SOMA_NAMES, SOMA_PARENTS } from './motion';

type Slot = 'start' | 'middle' | 'middle2';
const labels = { start: 'Start / End', middle: 'Middle', middle2: 'Middle 2' };
const bodyPoints = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
const previewExcluded = /Jaw|Eye|ThumbEnd|MiddleEnd/;
export function ImagePosePanel({
  value,
  onChange,
  disabled,
  onBusyChange,
}: {
  value: PoseReferences;
  onChange: (value: PoseReferences) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<Slot | null>(null);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{
    slot: Slot;
    original: ReviewedImage;
    draft: ReviewedImage;
  } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  const openReview = (slot: Slot, image: ReviewedImage) => {
    setSelected(null);
    setReview({ slot, original: image, draft: structuredClone(image) });
  };
  async function upload(slot: Slot, file: File) {
    const request = ++revision.current;
    setBusy(slot);
    onBusyChange(true);
    setError('');
    try {
      const image = await captureImagePose(file);
      if (request === revision.current) openReview(slot, image);
    } catch (e) {
      if (request === revision.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === revision.current) {
        setBusy(null);
        onBusyChange(false);
      }
    }
  }
  let fitted: ReturnType<typeof fitImagePose> | undefined;
  let issue = '';
  if (review) {
    try {
      fitted = fitImagePose(review.draft);
    } catch (e) {
      issue = e instanceof Error ? e.message : String(e);
    }
  }
  const updatePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const index = dragging.current;
    if (!review || index === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    setReview({ ...review, draft: moveImagePoint(review.draft, index, x, y) });
  };
  return (
    <section className="image-poses" aria-label={t('Image poses')}>
      <p className="small subtle">
        {t('One photo sets both Start and End. Add up to two optional middle poses.')}
      </p>
      {(['start', 'middle', 'middle2'] as Slot[]).map((slot) => (
        <div className="image-pose-slot" key={slot}>
          <div className="image-pose-slot-head">
            <strong>
              {t(labels[slot])}
              {slot !== 'start' && <span className="optional-label"> {t('(optional)')}</span>}
            </strong>
            <label className="pose-upload">
              {t(busy === slot ? 'Analyzing image…' : value[slot] ? 'Replace image' : 'Add image')}
              <input
                aria-label={`${t('Add image')}: ${t(labels[slot])}`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={disabled || !!busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(slot, file);
                }}
              />
            </label>
          </div>
          <div className="pose-slot-actions">
            {value[slot] && (
              <button
                className="pose-thumbnail"
                type="button"
                disabled={disabled || !!busy}
                onClick={() => openReview(slot, value[slot]!)}
                title={t('Review pose')}
              >
                <img src={value[slot]!.thumbnail} alt={t(labels[slot])} />
                <span>{t(value[slot]!.accepted ? 'Accepted' : 'Review pose')}</span>
              </button>
            )}
            {value[slot] && (
              <button
                type="button"
                disabled={disabled || !!busy}
                onClick={() => onChange({ ...value, [slot]: null })}
              >
                {t('Remove')}
              </button>
            )}
          </div>
          {value[slot] && (
            <label className="pose-timing">
              <span>
                {t('Pose timing')} ·{' '}
                {slot === 'start'
                  ? '0% / 100%'
                  : `${Math.round((slot === 'middle' ? value.middleTime : value.middle2Time) * 100)}%`}
              </span>
              <input
                aria-label={`${t(labels[slot])} ${t('Pose timing')}`}
                type="range"
                min={slot === 'start' ? 0 : 0.1}
                max={0.9}
                step={0.05}
                disabled={slot === 'start' || disabled || !!busy}
                title={
                  slot === 'start'
                    ? t('Loop endpoints stay fixed at the start and end.')
                    : undefined
                }
                value={
                  slot === 'start' ? 0 : slot === 'middle' ? value.middleTime : value.middle2Time
                }
                onChange={(e) =>
                  onChange({
                    ...value,
                    [slot === 'middle' ? 'middleTime' : 'middle2Time']: Number(e.target.value),
                  })
                }
              />
            </label>
          )}
        </div>
      ))}
      {error && <p role="alert">{t(error)}</p>}
      <Modal open={!!review} onClose={() => setReview(null)}>
        <Modal.Header sx={{ textAlign: 'center' }}>{t('Review image pose')}</Modal.Header>
        <Modal.Content className="pose-review-content">
          {review && (
            <>
              <p className="small pose-review-guidance">
                {t(
                  'Drag a point to correct it. Orange points need attention. Depth is estimated; compare both skeleton views.',
                )}
              </p>
              <div className="pose-review-image">
                <img src={review.draft.thumbnail} alt={review.draft.name} draggable={false} />
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  aria-label={t('Detected pose points')}
                  onPointerMove={updatePoint}
                  onPointerUp={() => {
                    dragging.current = null;
                  }}
                  onPointerCancel={() => {
                    dragging.current = null;
                  }}
                >
                  {POSE_EDGES.filter(([a, b]) => bodyPoints.has(a) && bodyPoints.has(b)).map(
                    ([a, b]) => (
                      <line
                        key={`${a}-${b}`}
                        x1={review.draft.landmarks[a][0]}
                        y1={review.draft.landmarks[a][1]}
                        x2={review.draft.landmarks[b][0]}
                        y2={review.draft.landmarks[b][1]}
                        stroke="#65e5c6"
                        strokeWidth="0.004"
                      />
                    ),
                  )}
                  {review.draft.landmarks.map(
                    ([x, y], i) =>
                      bodyPoints.has(i) && (
                        <circle
                          key={i}
                          data-index={i}
                          cx={x}
                          cy={y}
                          r={selected === i ? 0.013 : 0.009}
                          fill={review.draft.confidence[i] < 0.5 ? '#ffad47' : '#65e5c6'}
                          stroke="#172327"
                          strokeWidth="0.002"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            dragging.current = i;
                            setSelected(i);
                            e.currentTarget.ownerSVGElement!.setPointerCapture(e.pointerId);
                          }}
                        />
                      ),
                  )}
                </svg>
              </div>
              {selected !== null && (
                <label className="field-label">
                  {t('Selected point depth')}
                  <input
                    type="range"
                    aria-label={t('Selected point depth')}
                    min="-1.5"
                    max="1.5"
                    step="0.01"
                    value={review.draft.world[selected][2]}
                    onChange={(e) => {
                      const draft = structuredClone(review.draft);
                      draft.world[selected][2] = Number(e.target.value);
                      draft.accepted = false;
                      setReview({ ...review, draft });
                    }}
                  />
                </label>
              )}
              {fitted && (
                <div className="pose-skeleton-previews">
                  {[0, 2].map((axis) => (
                    <figure key={axis}>
                      <svg
                        viewBox="-1.2 -2.3 2.4 2.5"
                        role="img"
                        aria-label={t(axis === 0 ? 'Front pose preview' : 'Side pose preview')}
                      >
                        <line x1="-1.1" y1="0" x2="1.1" y2="0" stroke="#777" strokeWidth="0.015" />
                        {SOMA_PARENTS.map(
                          (parent, j) =>
                            parent >= 0 &&
                            !previewExcluded.test(SOMA_NAMES[j]) && (
                              <line
                                key={j}
                                x1={fitted!.positions[parent][axis]}
                                y1={-fitted!.positions[parent][1]}
                                x2={fitted!.positions[j][axis]}
                                y2={-fitted!.positions[j][1]}
                                stroke="#65c6e5"
                                strokeWidth="0.025"
                              />
                            ),
                        )}
                      </svg>
                      <figcaption>
                        {t(axis === 0 ? 'Front pose preview' : 'Side pose preview')}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <p className="small subtle pose-review-guidance">
                {t(
                  'Photos guide body pose, not finger detail or travel. Feet are grounded; hidden depth may need correction.',
                )}
              </p>
              {issue && <p role="alert">{t(issue)}</p>}
            </>
          )}
        </Modal.Content>
        <Modal.Actions className="pose-review-actions">
          <Button
            basic
            sx={{ color: '#6fc7b5', borderColor: '#6fc7b5', minWidth: 100 }}
            onClick={() =>
              review && setReview({ ...review, draft: structuredClone(review.original) })
            }
          >
            {t('Reset')}
          </Button>
          <Button
            basic
            sx={{ color: '#cbb6d5', borderColor: '#cbb6d5', minWidth: 100 }}
            onClick={() => setReview(null)}
          >
            {t('Cancel')}
          </Button>
          <Button
            basic
            sx={{ color: '#ff2d55', borderColor: '#ff2d55', minWidth: 100 }}
            disabled={!!issue || !review || disabled}
            onClick={() => {
              if (!review) return;
              onChange({ ...value, [review.slot]: { ...review.draft, accepted: true } });
              setReview(null);
            }}
          >
            {t('Accept pose')}
          </Button>
        </Modal.Actions>
      </Modal>
    </section>
  );
}
