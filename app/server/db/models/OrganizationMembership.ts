import mongoose from 'mongoose';

const organizationMembershipSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  memberKind: { type: String, enum: ['player', 'character'], required: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, required: true },
  title: { type: String, default: '' },
  publicNotes: { type: String, default: '' },
  privateNotes: { type: String, default: '' },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

organizationMembershipSchema.pre('save', function () {
  this.updatedAt = new Date();
});

// istanbul ignore next
if (typeof (organizationMembershipSchema as { index?: unknown }).index === 'function') {
  organizationMembershipSchema.index(
    { organizationId: 1, memberKind: 1, memberId: 1 },
    { unique: true }
  );
  organizationMembershipSchema.index({ campaignId: 1, memberKind: 1, memberId: 1 });
  organizationMembershipSchema.index({ organizationId: 1 });
}

export const OrganizationMembership =
  mongoose.models.OrganizationMembership ||
  mongoose.model('OrganizationMembership', organizationMembershipSchema);
