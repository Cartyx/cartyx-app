import mongoose, { type InferSchemaType, type Model } from 'mongoose';

const monthSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    days: { type: Number, required: true },
    isIntercalary: { type: Boolean, default: false },
  },
  { _id: false }
);
const leapSchema = new mongoose.Schema(
  { name: String, monthIndex: Number, interval: Number, offset: Number, addDays: Number },
  { _id: false }
);
const moonSchema = new mongoose.Schema(
  { name: String, cycleLength: Number, offsetDays: Number, color: String },
  { _id: false }
);
const seasonSchema = new mongoose.Schema(
  { name: String, startMonthIndex: Number, startDay: Number, color: String },
  { _id: false }
);
const holidaySchema = new mongoose.Schema(
  { name: String, monthIndex: Number, day: Number, color: String },
  { _id: false }
);
const calDateSchema = new mongoose.Schema(
  { year: Number, monthIndex: Number, day: Number },
  { _id: false }
);

const calendarSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  months: { type: [monthSchema], default: [] },
  weekdays: { type: [String], default: [] },
  weekdayMode: { type: String, enum: ['continuous', 'resetEachMonth'], default: 'continuous' },
  epoch: { year: { type: Number, default: 1 }, weekdayIndex: { type: Number, default: 0 } },
  yearSuffix: { type: String, default: '' },
  namedYears: {
    type: [new mongoose.Schema({ year: Number, name: String }, { _id: false })],
    default: [],
  },
  leapDays: { type: [leapSchema], default: [] },
  moons: { type: [moonSchema], default: [] },
  seasons: { type: [seasonSchema], default: [] },
  holidays: { type: [holidaySchema], default: [] },
  currentDate: { type: calDateSchema, default: () => ({ year: 1, monthIndex: 0, day: 1 }) },
  campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

calendarSchema.pre('save', function () {
  this.updatedAt = new Date();
});

export type ICalendar = InferSchemaType<typeof calendarSchema>;

export const Calendar: Model<ICalendar> =
  (mongoose.models.Calendar as Model<ICalendar>) ||
  mongoose.model<ICalendar>('Calendar', calendarSchema);
