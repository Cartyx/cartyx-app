import React from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, useRef } from 'react';
import { getMe } from '~/server/functions/rpc';
import { useCreateCampaign } from '~/hooks/useCampaigns';
import { Topbar } from '~/components/Topbar';
import { PixelButton } from '~/components/PixelButton';
import { ImagePlus, Swords } from 'lucide-react';
import { captureEvent } from '~/utils/posthog-client';
import { FormInput } from '~/components/FormInput';
import { FormTextarea } from '~/components/FormTextarea';
import { FormSelect } from '~/components/FormSelect';
import { StepWizard } from '~/components/StepWizard';
import { StatusBanner } from '~/components/StatusBanner';
import { SectionHeader } from '~/components/SectionHeader';

export const Route = createFileRoute('/campaigns/new')({
  beforeLoad: async () => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    if (user.role !== 'gm') throw redirect({ to: '/campaigns' });
    return { user };
  },
  component: NewCampaignPage,
});

const STEPS = ['THE QUEST', 'THE SCHEDULE', 'THE GATHERING', 'THE ROSTER', 'REVIEW'];
import { TIMEZONES } from '~/constants/timezones';

export function NewCampaignPage() {
  const navigate = useNavigate();
  const { create, isLoading, error: submitError } = useCreateCampaign();

  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [schedFreq, setSchedFreq] = useState('weekly');
  const [schedDay, setSchedDay] = useState('Sat');
  const [schedTime, setSchedTime] = useState('19:00');
  const [schedTz, setSchedTz] = useState('America/Chicago');
  const [links, setLinks] = useState([{ name: '', url: '' }]);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const fileRef = useRef<HTMLInputElement>(null);

  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
  const MAX_GIF_SIZE = 3 * 1024 * 1024;

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setStepError('Only PNG, JPEG, GIF, and WebP images are allowed');
      return;
    }
    if (file.type === 'image/gif' && file.size > MAX_GIF_SIZE) {
      setStepError('GIFs must be under 3MB');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setStepError('Image must be under 10MB');
      return;
    }
    setStepError('');
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function validateStep(n: number): boolean {
    setStepError('');
    if (n === 1) {
      if (!name.trim()) {
        setStepError('Campaign name is required.');
        return false;
      }
      // Description is optional (matches server schema: z.string().default(''))
    }
    return true;
  }

  function goTo(n: number) {
    if (n === step) return;
    if (n > step && !validateStep(step)) return;
    setStepError('');
    const fromStep = step;
    setStep(n);
    captureEvent('campaign_wizard_step_changed', { from_step: fromStep, to_step: n });
  }

  async function handleSubmit() {
    const result = await create({
      name,
      description: desc,
      schedFreq,
      schedDay,
      schedTime,
      schedTz,
      links: links.filter((l) => l.name.trim() || l.url.trim()),
      maxPlayers,
      imageFile,
    });
    if (result) {
      captureEvent('campaign_wizard_completed', { campaign_name: name.trim() });
      navigate({
        to: '/campaigns/$campaignId/play',
        params: { campaignId: result.campaignId },
        search: { tab: 'dashboard' },
      });
    }
  }

  const freqMap: Record<string, string> = {
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
    monthly: 'Monthly',
  };
  const descShort = desc.length > 80 ? desc.slice(0, 80) + '...' : desc;

  const timezoneOptions = TIMEZONES.map(([val, label]) => ({ value: val, label }));

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-[680px] mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-sans font-semibold text-[13px] text-white tracking-widest">
            NEW CAMPAIGN
          </h1>
          <a
            href="/campaigns"
            className="text-xs text-slate-500 hover:text-slate-400 transition-colors font-medium"
          >
            ← Back
          </a>
        </div>

        <StepWizard steps={STEPS} currentStep={step} onStepClick={goTo} />

        {(stepError || submitError) && (
          <StatusBanner variant="error" message={stepError || submitError || ''} className="mb-4" />
        )}

        <div className="bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden">
          {/* Step panels */}
          <div className="p-8 pb-6">
            {step === 1 && (
              <>
                <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
                  THE QUEST
                </SectionHeader>
                <div className="space-y-5">
                  <FormInput
                    label={
                      <>
                        Campaign Name <span className="text-red-400">*</span>
                      </>
                    }
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter campaign name..."
                    maxLength={60}
                    hint={`${name.length}/60`}
                    hintAlign="right"
                  />
                  <FormTextarea
                    label={
                      <>
                        Description <span className="text-slate-600 font-normal">(optional)</span>
                      </>
                    }
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    placeholder="Describe your campaign..."
                    maxLength={500}
                    rows={4}
                    textareaClassName="min-h-[100px]"
                  />
                  <div>
                    <label
                      htmlFor="banner-image-input"
                      className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide"
                    >
                      Banner Image <span className="text-slate-600 font-normal">(optional)</span>
                    </label>
                    <button
                      type="button"
                      className="w-full border-2 border-dashed border-white/10 rounded-xl p-7 text-center cursor-pointer hover:border-blue-500/40 hover:bg-blue-600/[0.04] transition-all bg-transparent"
                      onClick={() => fileRef.current?.click()}
                    >
                      {imagePreview ? (
                        <img
                          src={imagePreview}
                          className="max-w-full max-h-48 rounded-lg object-cover mx-auto"
                          alt="Preview"
                        />
                      ) : (
                        <>
                          <ImagePlus className="h-8 w-8 text-slate-500 mb-2" />
                          <div className="text-sm text-slate-500">
                            Click to upload a banner image
                          </div>
                          <div className="text-xs text-slate-600 mt-1 mb-0.5">
                            Recommended: 1200 × 400px or larger
                          </div>
                          <div className="text-xs text-slate-700">
                            PNG, JPG, WebP up to 10MB · GIF up to 3MB
                          </div>
                        </>
                      )}
                    </button>
                    <input
                      ref={fileRef}
                      id="banner-image-input"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
                  THE SCHEDULE
                </SectionHeader>
                <div className="space-y-5">
                  <fieldset className="border-none p-0 m-0">
                    <legend className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                      Frequency
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {['weekly', 'biweekly', 'monthly'].map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setSchedFreq(f)}
                          className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                            schedFreq === f
                              ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                              : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-blue-500/30 hover:text-slate-400'
                          }`}
                        >
                          {f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Bi-weekly' : 'Monthly'}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="border-none p-0 m-0">
                    <legend className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                      Day of Week
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSchedDay(d)}
                          className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                            schedDay === d
                              ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                              : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-blue-500/30 hover:text-slate-400'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="grid grid-cols-2 gap-4">
                    <FormInput
                      label="Time"
                      type="time"
                      value={schedTime}
                      onChange={(e) => setSchedTime(e.target.value)}
                    />
                    <FormSelect
                      label="Timezone"
                      value={schedTz}
                      onChange={(e) => setSchedTz(e.target.value)}
                      options={timezoneOptions}
                    />
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
                  THE GATHERING
                </SectionHeader>
                <fieldset className="space-y-3 border-none p-0 m-0">
                  <legend className="block text-xs font-semibold text-slate-400 mb-2 tracking-wide">
                    Links <span className="text-slate-600 font-normal">(optional)</span>
                  </legend>
                  {links.map((link, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={link.name}
                        onChange={(e) =>
                          setLinks(
                            links.map((l, j) => (j === i ? { ...l, name: e.target.value } : l))
                          )
                        }
                        placeholder="Name (e.g. Discord)"
                        className="w-32 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-3 text-slate-200 text-sm placeholder-slate-700 focus:outline-none focus:border-blue-500/50 transition-all"
                      />
                      <input
                        type="url"
                        value={link.url}
                        onChange={(e) =>
                          setLinks(
                            links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l))
                          )
                        }
                        placeholder="https://..."
                        className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-3 text-slate-200 text-sm placeholder-slate-700 focus:outline-none focus:border-blue-500/50 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setLinks(links.filter((_, j) => j !== i))}
                        className="text-slate-600 hover:text-red-400 transition-colors text-lg leading-none px-1"
                        aria-label="Remove link"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setLinks([...links, { name: '', url: '' }])}
                    className="text-xs text-blue-500 hover:text-blue-400 transition-colors font-medium mt-1"
                  >
                    + Add Link
                  </button>
                </fieldset>
              </>
            )}

            {step === 4 && (
              <>
                <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
                  THE ROSTER
                </SectionHeader>
                <fieldset className="border-none p-0 m-0">
                  <legend className="block text-xs font-semibold text-slate-400 mb-3 tracking-wide">
                    Max Player Slots
                  </legend>
                  <div className="flex flex-wrap gap-2.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setMaxPlayers(n)}
                        className={`w-12 h-12 rounded-xl border text-base font-bold transition-all ${
                          maxPlayers === n
                            ? 'bg-blue-600/25 border-blue-500/70 text-blue-300 shadow-lg shadow-blue-500/20'
                            : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-blue-500/30 hover:text-slate-400'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-700 mt-3.5">
                    The GM does not occupy a player slot.
                  </p>
                </fieldset>
              </>
            )}

            {step === 5 && (
              <>
                <SectionHeader size="xs" tracking="tracking-[3px]" className="mb-7">
                  REVIEW
                </SectionHeader>
                <div className="space-y-4">
                  {[
                    {
                      title: 'THE QUEST',
                      rows: [
                        ['Name', name],
                        ['Description', descShort],
                      ],
                    },
                    {
                      title: 'THE SCHEDULE',
                      rows: [
                        ['Frequency', freqMap[schedFreq] ?? schedFreq],
                        ['Day', schedDay || 'Not set'],
                        ['Time', schedTime ? `${schedTime} ${schedTz}` : 'Not set'],
                      ],
                    },
                    {
                      title: 'THE GATHERING',
                      rows:
                        links.filter((l) => l.name.trim() || l.url.trim()).length > 0
                          ? links
                              .filter((l) => l.name.trim() || l.url.trim())
                              .map((l) => [l.name || '(unnamed)', l.url || 'None'])
                          : [['Links', 'None']],
                    },
                    { title: 'THE ROSTER', rows: [['Max Players', `${maxPlayers} players`]] },
                  ].map((section) => (
                    <div key={section.title}>
                      <SectionHeader color="muted" tracking="tracking-widest" className="mb-2">
                        {section.title}
                      </SectionHeader>
                      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl px-4 py-1">
                        {section.rows.map(([label, value]) => (
                          <div
                            key={label}
                            className="flex justify-between items-start py-1.5 border-b border-white/[0.04] last:border-0"
                          >
                            <span className="text-xs text-slate-500 font-medium">{label}</span>
                            <span
                              className={`text-xs max-w-[60%] text-right break-words ${value ? 'text-slate-400' : 'text-slate-600 italic'}`}
                            >
                              {value || 'Not set'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Footer nav */}
          <div className="flex items-center justify-between px-8 py-5 border-t border-white/[0.06]">
            <PixelButton
              variant="secondary"
              size="sm"
              onClick={() => goTo(step - 1)}
              style={{ visibility: step === 1 ? 'hidden' : 'visible' }}
              type="button"
            >
              ← Back
            </PixelButton>
            <span className="font-sans font-semibold text-[9px] text-slate-700">
              {step} / {STEPS.length}
            </span>
            {step < STEPS.length ? (
              <PixelButton variant="primary" size="sm" onClick={() => goTo(step + 1)} type="button">
                Continue →
              </PixelButton>
            ) : (
              <PixelButton
                variant="primary"
                size="sm"
                icon={<Swords className="h-3.5 w-3.5" />}
                onClick={handleSubmit}
                disabled={isLoading}
                type="button"
              >
                {isLoading ? 'Creating...' : 'Create Campaign'}
              </PixelButton>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
