import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Globe, Lock } from 'lucide-react';
import { FormInput } from '~/components/FormInput';
import { PixelButton } from '~/components/PixelButton';
import { MarkdownEditor } from '~/components/shared/MarkdownEditor';
import { TagAutocompleteInput } from '~/components/shared/TagAutocompleteInput';
import { EventLinksEditor } from '~/components/wiki/calendar/EventLinksEditor';
import { CalDatePicker } from '~/components/wiki/calendar/CalDatePicker';
import { useEvent, useCreateEvent, useUpdateEvent, useDeleteEvent } from '~/hooks/useEvents';
import { useCalendar } from '~/hooks/useCalendar';
import { useModalForm } from '~/hooks/useModalForm';
import { uploadToR2 } from '~/utils/uploadToR2';
import { compressImage } from '~/utils/compressImage';
import { validateDate } from '~/utils/calendarEngine';
import { calendarConfigFromData } from '~/types/calendar';
import type { EventLink, EventImage } from '~/types/event';
import type { CalDate } from '~/types/calendar';

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  eventId?: string;
}

interface FieldErrors {
  title?: string;
  start?: string;
  end?: string;
}

export function EventModal({ isOpen, onClose, campaignId, eventId }: EventModalProps) {
  const isEdit = !!eventId;

  const { event: existingEvent, isLoading: isFetchingEvent } = useEvent(eventId ?? '', campaignId);
  const { create, isLoading: isCreating } = useCreateEvent();
  const { update, isLoading: isUpdating } = useUpdateEvent();
  const { remove, isLoading: isDeleting } = useDeleteEvent();
  const { calendar } = useCalendar(campaignId);

  const cfg = calendar ? calendarConfigFromData(calendar) : null;
  const defaultDate: CalDate = calendar ? calendar.currentDate : { year: 1, monthIndex: 0, day: 1 };

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [gmContent, setGmContent] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isEpic, setIsEpic] = useState(false);
  const [start, setStart] = useState<CalDate>(defaultDate);
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [end, setEnd] = useState<CalDate | null>(null);
  const [links, setLinks] = useState<EventLink[]>([]);
  const [sessionId] = useState<string | null>(null);
  const [images, setImages] = useState<EventImage[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [color] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const validate = useCallback((): FieldErrors => {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = 'Title is required';
    if (cfg) {
      const startResult = validateDate(cfg, start);
      if (!startResult.ok) errors.start = startResult.error ?? 'Invalid start date';
      if (isMultiDay && end !== null) {
        const endResult = validateDate(cfg, end);
        if (!endResult.ok) errors.end = endResult.error ?? 'Invalid end date';
      }
    }
    return errors;
  }, [title, cfg, start, isMultiDay, end]);

  const { fieldErrors, runValidation } = useModalForm({
    isOpen,
    onClose,
    recordId: eventId,
    isEdit,
    record: existingEvent,
    reset: () => {
      setTitle('');
      setContent('');
      setGmContent('');
      setIsPublic(false);
      setIsEpic(false);
      setStart(defaultDate);
      setIsMultiDay(false);
      setEnd(null);
      setLinks([]);
      setImages([]);
      setTags([]);
      setError(null);
      setShowDeleteConfirm(false);
    },
    populate: (ev) => {
      setTitle(ev.title);
      setContent(ev.content);
      setGmContent(ev.gmContent);
      setIsPublic(ev.isPublic);
      setIsEpic(ev.isEpic);
      setStart(ev.start);
      if (ev.end !== null) {
        setIsMultiDay(true);
        setEnd(ev.end);
      } else {
        setIsMultiDay(false);
        setEnd(null);
      }
      setLinks(ev.links);
      setImages(ev.images);
      setTags(ev.tags);
    },
    validate,
  });

  const handleAddImage = useCallback(async (file: File) => {
    setIsUploadingImage(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      const { publicUrl } = await uploadToR2(compressed, 'uploads/events');
      const newImage: EventImage = { url: publicUrl, caption: '', crop: null };
      setImages((prev) => [...prev, newImage]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image upload failed');
    } finally {
      setIsUploadingImage(false);
    }
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleAddImage(file);
      e.target.value = '';
    },
    [handleAddImage]
  );

  const handleMultiDayChange = (checked: boolean) => {
    setIsMultiDay(checked);
    if (checked && end === null) {
      setEnd(start);
    } else if (!checked) {
      setEnd(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const errors = runValidation();
    if (Object.keys(errors).length > 0) return;

    const input = {
      campaignId,
      title: title.trim(),
      content,
      gmContent,
      isPublic,
      isEpic,
      start,
      end: isMultiDay ? end : null,
      links: links.map((l) => ({ kind: l.kind, id: l.id })),
      sessionId,
      images: images.map((img) => ({
        url: img.url,
        caption: img.caption,
        crop: img.crop,
      })),
      tags,
      color,
    };

    let success = false;
    if (isEdit && eventId) {
      const result = await update({ ...input, id: eventId });
      success = !!result;
    } else {
      const result = await create(input);
      success = !!result;
    }

    if (success) {
      onClose();
    } else {
      setError(`Failed to ${isEdit ? 'update' : 'create'} event. Please try again.`);
    }
  };

  const handleDelete = async () => {
    if (!eventId) return;
    const result = await remove({ id: eventId, campaignId });
    if (result !== undefined) {
      onClose();
    } else {
      setError('Failed to delete event. Please try again.');
    }
  };

  if (!isOpen) return null;

  const isLoadingEvent = !!(isEdit && isFetchingEvent);
  const isSaving = isCreating || isUpdating;
  const isBusy = isLoadingEvent || isSaving || isUploadingImage || isDeleting;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-modal-title"
        className="w-full h-full max-w-[90vw] max-h-[90vh] sm:max-w-[90vw] sm:max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <h2
            id="event-modal-title"
            className="font-sans font-bold text-sm text-blue-400 uppercase tracking-widest"
          >
            {isEdit ? 'Edit Event' : 'Create Event'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 min-h-0">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-semibold">
              {error}
            </div>
          )}

          {isLoadingEvent ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs text-slate-500 animate-pulse">Loading event...</p>
            </div>
          ) : (
            <>
              {/* Title */}
              <FormInput
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                error={fieldErrors.title}
                required
                disabled={isBusy}
                placeholder="Event title"
                data-testid="event-title-input"
              />

              {/* Epic toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="event-epic-toggle"
                  disabled={isBusy}
                  onClick={() => setIsEpic((v) => !v)}
                  className={`h-9 px-4 rounded-xl border flex items-center gap-2 transition-all text-xs font-semibold ${
                    isEpic
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                      : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'
                  }`}
                >
                  {isEpic ? 'Epic event' : 'Mark as epic'}
                </button>
              </div>

              {/* Start date */}
              <div>
                <span className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                  Start date
                </span>
                {cfg ? (
                  <>
                    <CalDatePicker
                      cfg={cfg}
                      value={start}
                      onChange={setStart}
                      disabled={isBusy}
                      idPrefix="event-start"
                    />
                    {fieldErrors.start && (
                      <p className="text-xs text-rose-400 mt-1">{fieldErrors.start}</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">No calendar configured.</p>
                )}
              </div>

              {/* Multi-day toggle + end date */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={isMultiDay}
                    onChange={(e) => handleMultiDayChange(e.target.checked)}
                    disabled={isBusy}
                    className="rounded border-white/20 bg-white/[0.04] text-blue-500 focus:ring-blue-500/30"
                  />
                  <span className="text-xs font-semibold text-slate-400">Multi-day event</span>
                </label>

                {isMultiDay && end !== null && cfg && (
                  <div>
                    <span className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                      End date
                    </span>
                    <CalDatePicker
                      cfg={cfg}
                      value={end}
                      onChange={setEnd}
                      disabled={isBusy}
                      idPrefix="event-end"
                    />
                    {fieldErrors.end && (
                      <p className="text-xs text-rose-400 mt-1">{fieldErrors.end}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Content */}
              <MarkdownEditor
                label="Content"
                value={content}
                onChange={setContent}
                placeholder="Public event content..."
                disabled={isBusy}
                minHeight="120px"
                id="event-content-editor"
              />

              {/* GM Notes — always shown (only GMs reach EventModal) */}
              <MarkdownEditor
                label={
                  <span>
                    GM Notes{' '}
                    <span className="text-amber-500 text-[10px] font-normal">
                      (only visible to GM)
                    </span>
                  </span>
                }
                value={gmContent}
                onChange={setGmContent}
                placeholder="GM-only event notes..."
                disabled={isBusy}
                minHeight="120px"
                id="event-gmcontent-editor"
              />

              {/* Images */}
              <div>
                <span className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                  Images
                </span>
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-3">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative group">
                        <img
                          src={img.url}
                          alt={img.caption || `Event image ${idx + 1}`}
                          className="w-20 h-20 object-cover rounded-lg border border-white/10"
                        />
                        {!isBusy && (
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(idx)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 flex items-center justify-center hover:bg-rose-500 transition-colors"
                            aria-label={`Remove image ${idx + 1}`}
                          >
                            <X className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <label
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${isBusy || isUploadingImage ? 'opacity-50 cursor-not-allowed border-white/10 text-slate-500' : 'border-white/10 text-slate-300 hover:border-blue-500/50 hover:text-blue-300'}`}
                >
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handleImageFileChange}
                    disabled={isBusy || isUploadingImage}
                    className="hidden"
                  />
                  {isUploadingImage ? 'Uploading...' : 'Add image'}
                </label>
                <p className="text-xs text-slate-700 mt-1.5">JPG, PNG, or WebP. Max 5MB.</p>
              </div>

              {/* Tags */}
              <div>
                <label
                  htmlFor="event-tags-input"
                  className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
                >
                  Tags
                </label>
                <TagAutocompleteInput
                  campaignId={campaignId}
                  selectedTags={tags}
                  onTagsChange={setTags}
                  placeholder="Type a tag and press Enter"
                  disabled={isBusy}
                  id="event-tags-input"
                />
                <p className="text-xs text-slate-700 mt-1.5">
                  Press Enter or comma to add. Suggestions appear as you type.
                </p>
              </div>

              {/* Visibility */}
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="event-visibility"
                    checked={!isPublic}
                    onChange={() => setIsPublic(false)}
                    className="sr-only"
                    disabled={isBusy}
                  />
                  <div
                    className={`h-10 px-4 rounded-xl border flex items-center gap-2.5 transition-all ${
                      !isPublic
                        ? 'bg-blue-600/10 border-blue-500/50 text-blue-300 shadow-sm shadow-blue-500/10'
                        : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'
                    }`}
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span className="font-sans font-bold text-xs">Private</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="event-visibility"
                    checked={isPublic}
                    onChange={() => setIsPublic(true)}
                    className="sr-only"
                    disabled={isBusy}
                  />
                  <div
                    className={`h-10 px-4 rounded-xl border flex items-center gap-2.5 transition-all ${
                      isPublic
                        ? 'bg-emerald-600/10 border-emerald-500/50 text-emerald-300 shadow-sm shadow-emerald-500/10'
                        : 'bg-white/[0.03] border-white/[0.07] text-slate-500 hover:border-white/20'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span className="font-sans font-bold text-xs">Public</span>
                  </div>
                </label>
              </div>

              {/* Linked Entities */}
              <EventLinksEditor
                campaignId={campaignId}
                links={links}
                onChange={setLinks}
                disabled={isBusy}
              />
            </>
          )}
        </div>

        <footer className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-white/[0.07] bg-white/[0.01] shrink-0">
          {/* Delete side */}
          <div>
            {isEdit && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isBusy}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 border border-rose-500/20 hover:bg-rose-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete
              </button>
            )}
            {isEdit && showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-rose-400 font-semibold">Delete this event?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isBusy}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isBusy}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Save/Cancel side */}
          <div className="flex items-center gap-3">
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
              type="button"
            >
              Cancel
            </PixelButton>
            <PixelButton variant="primary" size="sm" disabled={isBusy} type="submit">
              {isSaving
                ? 'Saving...'
                : isLoadingEvent
                  ? 'Loading...'
                  : isEdit
                    ? 'Update Event'
                    : 'Create Event'}
            </PixelButton>
          </div>
        </footer>
      </form>
    </div>,
    document.body
  );
}
