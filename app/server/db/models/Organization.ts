import mongoose, { type InferSchemaType, type Model } from 'mongoose';
import { normalizeTags } from '~/server/utils/helpers';

const locationLinkSchema = new mongoose.Schema(
  {
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true },
    publicInfo: { type: String, default: '' },
    privateInfo: { type: String, default: '' },
  },
  { _id: false }
);

const cropSchema = new mongoose.Schema(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    caption: { type: String, default: '' },
    crop: { type: cropSchema, default: null },
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  publicInfo: { type: String, default: '' },
  privateInfo: { type: String, default: '' },
  isPublic: { type: Boolean, default: false },
  images: { type: [imageSchema], default: [] },
  locations: { type: [locationLinkSchema], default: [] },
  tags: { type: [String], default: [] },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

organizationSchema.pre('save', function () {
  if (this.isModified('tags')) {
    this.tags = normalizeTags(this.tags as string[]);
  }
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (organizationSchema as { index?: unknown }).index === 'function') {
  organizationSchema.index({ campaignId: 1 });
  organizationSchema.index({ campaignId: 1, updatedAt: -1 });
  organizationSchema.index({ createdBy: 1 });
  organizationSchema.index({ tags: 1 });
  organizationSchema.index({ isPublic: 1 });
  organizationSchema.index({ 'locations.locationId': 1 });
  organizationSchema.index({ name: 'text', publicInfo: 'text' });
}

export type IOrganization = InferSchemaType<typeof organizationSchema>;

export const Organization: Model<IOrganization> =
  (mongoose.models.Organization as Model<IOrganization>) ||
  mongoose.model<IOrganization>('Organization', organizationSchema);
