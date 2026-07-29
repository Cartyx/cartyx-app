import { z } from 'zod';
import { getSession } from '../session';
import { getUploadUrlSchema } from '~/types/schemas/uploads';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { serverCaptureException } from '../utils/telemetry';
import { AUDIO_SOURCE_TYPES, AUDIO_MAX_BYTES } from '~/types/audio';

const ALLOWED_TYPES = new Map([
  ['image/webp', 'webp'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
]);

type R2 = { client: S3Client; bucket: string; cdnUrl: string };

/** Shared R2 bootstrap for image and audio uploads. Throws when config is incomplete. */
export function createR2(): R2 {
  const cdnUrl = process.env.CDN_URL;
  if (!cdnUrl) throw new Error('Direct uploads require CDN_URL configuration');

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2 configuration incomplete');
  }

  return {
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    cdnUrl: cdnUrl.replace(/\/+$/, ''),
  };
}

export const getUploadUrl = async ({ data }: { data: z.infer<typeof getUploadUrlSchema> }) => {
  const user = await getSession();
  try {
    if (!user) throw new Error('Not authenticated');

    const ext = ALLOWED_TYPES.get(data.contentType);
    if (!ext) throw new Error('Only PNG, JPEG, GIF, and WebP images are allowed');

    const { client, bucket, cdnUrl } = createR2();

    const key = `${data.subdir}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: data.contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });

    return { uploadUrl, imageKey: key, publicUrl: `${cdnUrl}/${key}` };
  } catch (e) {
    serverCaptureException(e, user?.id, { action: 'getUploadUrl' });
    throw e;
  }
};

/**
 * Mints a presigned PUT for an audio source object.
 *
 * Deliberately auth-agnostic: it takes `userId` rather than calling
 * `getSession()` itself. Ingest is one shared module behind two adapters that
 * authenticate differently (`~/utils/audio-server-fns` via session cookie,
 * `~/routes/api/audio/uploads` via bearer token — see the design doc's "Ingest
 * API surface"). Reading the session cookie here would 500 every token-
 * authenticated ingest call the moment phase 3 issues a real token, which is
 * precisely the restructuring this phase exists to avoid. The caller has
 * already authenticated and knows who is acting.
 *
 * `telemetryUserId` is used for telemetry ONLY — nothing here is scoped by it,
 * which is why it is named for its single purpose rather than as a generic
 * `userId`.
 *
 * It must carry the SAME identity every other server function tags with: the
 * OAuth provider's subject id, which is what `requireCampaignMember` returns as
 * `sessionUserId` and what `getUploadUrl` above passes (`user?.id`). This
 * parameter used to be the User document's Mongo `_id`, with a comment claiming
 * that choice kept one failed upload from surfacing under two identities — the
 * comment had it exactly backwards. Mongo `_id` is what the *rest of the audio
 * module* used and the provider id is what the other ~150 telemetry call sites
 * in `app/server/functions/` use, so the same human minting an image upload URL
 * and an audio upload URL landed in GlitchTip and Umami as two unrelated
 * people. `~/server/functions/audio.ts` now threads `sessionUserId` through for
 * this reason; see the `Actor` type there.
 */
export const getAudioUploadUrl = async ({
  contentType,
  bytes,
  telemetryUserId,
}: {
  contentType: string;
  bytes: number;
  telemetryUserId: string;
}) => {
  try {
    const ext = AUDIO_SOURCE_TYPES.get(contentType);
    if (!ext) throw new Error(`Unsupported audio type: ${contentType}`);
    if (bytes > AUDIO_MAX_BYTES) {
      throw new Error(`File too large: max ${AUDIO_MAX_BYTES} bytes`);
    }

    const { client, bucket, cdnUrl } = createR2();
    const key = `uploads/audio/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      { expiresIn: 300 }
    );

    return { uploadUrl, key, publicUrl: `${cdnUrl}/${key}` };
  } catch (e) {
    serverCaptureException(e, telemetryUserId, { action: 'getAudioUploadUrl' });
    throw e;
  }
};
