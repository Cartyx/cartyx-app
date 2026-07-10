import React from 'react';
import { createFileRoute, redirect, useNavigate, Link } from '@tanstack/react-router';
import { useState, useRef } from 'react';
import { getMe, getCampaign } from '~/server/functions/rpc';
import { getQueryClient } from '~/providers/QueryProvider';
import { queryKeys } from '~/utils/queryKeys';
import { useUpdateCampaign } from '~/hooks/useCampaigns';
import { Topbar } from '~/components/Topbar';
import { PixelButton } from '~/components/PixelButton';
import { ImagePlus } from 'lucide-react';
import { TIMEZONES } from '~/constants/timezones';
import { FormInput } from '~/components/FormInput';
import { FormTextarea } from '~/components/FormTextarea';
import { FormSelect } from '~/components/FormSelect';
import { StatusBanner } from '~/components/StatusBanner';
import { SectionHeader } from '~/components/SectionHeader';

export const Route = createFileRoute('/campaigns/$campaignId/edit')({
  beforeLoad: async ({ params }) => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    const campaign = await getQueryClient().ensureQueryData({
      queryKey: queryKeys.campaigns.detail(params.campaignId),
      queryFn: () => getCampaign({ data: { id: params.campaignId } }),
    });
    if (!campaign) throw redirect({ to: '/campaigns' });
    if (!campaign.isOwner) throw redirect({ to: '/campaigns' });
    return { user, campaign };
  },
  component: EditCampaignPage,
});

function EditCampaignPage() {
  const { campaign } = Route.useRouteContext();
  const navigate = useNavigate();
  const { update, isLoading, error: submitError } = useUpdateCampaign();

  const [name, setName] = useState(campaign.name);
  const [desc, setDesc] = useState(campaign.description);
  const [schedFreq, setSchedFreq] = useState(campaign.schedule.frequency ?? '');
  const [schedDay, setSchedDay] = useState(campaign.schedule.dayOfWeek ?? '');
  const [schedTime, setSchedTime] = useState(campaign.schedule.time ?? '');
  const [schedTz, setSchedTz] = useState(campaign.schedule.timezone ?? 'America/New_York');
  const [links, setLinks] = useState(
    campaign.links && campaign.links.length > 0 ? campaign.links : [{ name: '', url: '' }]
  );
  const [maxPlayers, setMaxPlayers] = useState(campaign.maxPlayers);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(campaign.imagePath);
  const fileRef = useRef<HTMLInputElement>(null);

  const [imageError, setImageError] = useState('');
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
  const MAX_GIF_SIZE = 3 * 1024 * 1024;

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError('Only PNG, JPEG, GIF, and WebP images are allowed');
      return;
    }
    if (file.type === 'image/gif' && file.size > MAX_GIF_SIZE) {
      setImageError('GIFs must be under 3MB');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError('Image must be under 10MB');
      return;
    }
    setImageError('');
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    const result = await update(campaign.id, {
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
      navigate({ to: '/campaigns' });
    }
  }

  const sectionCls = 'bg-[#0D1117] border border-white/[0.07] rounded-2xl p-7 mb-5 shadow-lg';
  const labelCls = 'block text-xs font-semibold text-slate-400 mb-2 tracking-wide uppercase';

  const timezoneOptions = TIMEZONES.map(([val, lbl]) => ({ value: val, label: lbl }));

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-[760px] mx-auto px-8 py-12">
        <Link
          to="/campaigns"
          className="inline-flex items-center gap-1.5 text-slate-500 text-sm hover:text-slate-400 transition-colors mb-8"
        >
          ← Back to Campaigns
        </Link>
        <h1 className="font-sans font-semibold text-[13px] text-white tracking-widest mb-9">
          EDIT CAMPAIGN
        </h1>

        {submitError && <StatusBanner variant="error" message={submitError} className="mb-5" />}

        <div className={sectionCls}>
          <SectionHeader size="xs" tracking="tracking-widest" className="mb-5">
            Basic Info
          </SectionHeader>
          <FormInput
            label="Campaign Name *"
            labelClassName="uppercase"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Lost Mines of Phandelver"
            wrapperClassName="mb-5"
          />
          <FormTextarea
            label="Description"
            labelClassName="uppercase"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Tell your players what awaits them..."
            textareaClassName="min-h-[100px]"
          />
        </div>

        <div className={sectionCls}>
          <SectionHeader size="xs" tracking="tracking-widest" className="mb-5">
            Banner Image
          </SectionHeader>
          {imageError && <StatusBanner variant="error" message={imageError} className="mb-3" />}
          <button
            type="button"
            className="w-full border-2 border-dashed border-white/10 rounded-xl p-7 text-center cursor-pointer hover:border-blue-500/40 hover:bg-blue-600/[0.04] transition-all relative overflow-hidden bg-transparent"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="absolute inset-0 opacity-0 cursor-pointer w-full"
              onChange={handleImageChange}
              tabIndex={-1}
            />
            {imagePreview ? (
              <img
                src={imagePreview}
                className="max-w-full max-h-44 rounded-xl object-cover mx-auto"
                alt="Banner"
              />
            ) : (
              <>
                <ImagePlus className="h-8 w-8 text-slate-500 mb-2" />
                <div className="text-sm text-slate-500">
                  Drop an image here or <span className="text-blue-400">browse</span>
                </div>
                <div className="text-xs text-slate-700 mt-1">
                  PNG, JPG, WebP up to 10MB · GIF up to 3MB
                </div>
              </>
            )}
          </button>
        </div>

        <div className={sectionCls}>
          <SectionHeader size="xs" tracking="tracking-widest" className="mb-5">
            Schedule
          </SectionHeader>
          <fieldset className="mb-5 border-none p-0 m-0">
            <legend className={labelCls}>Frequency</legend>
            <div className="flex flex-wrap gap-2">
              {[
                ['weekly', 'Weekly'],
                ['biweekly', 'Bi-weekly'],
                ['monthly', 'Monthly'],
              ].map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSchedFreq(val!)}
                  className={`px-4 py-2 rounded-lg border text-sm font-semibold cursor-pointer transition-all ${schedFreq === val ? 'bg-blue-600/15 border-blue-500 text-blue-400' : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-blue-500/30 hover:text-slate-400'}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="mb-5 border-none p-0 m-0">
            <legend className={labelCls}>Day of Week</legend>
            <div className="flex flex-wrap gap-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSchedDay(d)}
                  className={`px-3 py-2 rounded-lg border text-sm font-semibold cursor-pointer transition-all ${schedDay === d ? 'bg-blue-600/15 border-blue-500 text-blue-400' : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-blue-500/30 hover:text-slate-400'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <FormInput
              label="Time"
              labelClassName="uppercase"
              type="time"
              value={schedTime}
              onChange={(e) => setSchedTime(e.target.value)}
            />
            <FormSelect
              label="Timezone"
              labelClassName="uppercase"
              value={schedTz}
              onChange={(e) => setSchedTz(e.target.value)}
              options={timezoneOptions}
            />
          </div>
        </div>

        <div className={sectionCls}>
          <SectionHeader size="xs" tracking="tracking-widest" className="mb-5">
            Links
          </SectionHeader>
          <div className="space-y-3">
            {links.map((link, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={link.name}
                  onChange={(e) =>
                    setLinks(links.map((l, j) => (j === i ? { ...l, name: e.target.value } : l)))
                  }
                  placeholder="Name (e.g. Discord)"
                  className="w-36 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-3 text-slate-200 text-sm placeholder-slate-700 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.06] transition-all"
                />
                <input
                  type="url"
                  value={link.url}
                  onChange={(e) =>
                    setLinks(links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))
                  }
                  placeholder="https://..."
                  className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-3 text-slate-200 text-sm placeholder-slate-700 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.06] transition-all"
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
          </div>
        </div>

        <div className={sectionCls}>
          <SectionHeader size="xs" tracking="tracking-widest" className="mb-5">
            Players
          </SectionHeader>
          <fieldset className="border-none p-0 m-0">
            <legend className={labelCls}>Max Players</legend>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxPlayers(n)}
                  className={`w-11 h-11 rounded-xl border text-sm font-bold transition-all ${maxPlayers === n ? 'bg-blue-600/20 border-blue-500/70 text-blue-300' : 'bg-white/[0.04] border-white/10 text-slate-500 hover:border-blue-500/30 hover:text-slate-400'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <PixelButton
          variant="primary"
          size="lg"
          onClick={handleSubmit}
          disabled={isLoading}
          fullWidth
          className="mt-2"
        >
          {isLoading ? 'Saving…' : 'Save Changes'}
        </PixelButton>
      </main>
    </div>
  );
}
