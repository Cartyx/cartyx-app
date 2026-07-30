import type { Meta, StoryObj } from '@storybook/react-vite';
import { AudioUploadDropzone } from './AudioUploadDropzone';

const meta: Meta<typeof AudioUploadDropzone> = {
  title: 'Audio/AudioUploadDropzone',
  component: AudioUploadDropzone,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-lg bg-[#0D1117] p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * No `play` interaction here: choosing/dropping a file would run the real
 * `uploadAudioFile` presign -> PUT -> confirm flow, which needs a live
 * server and isn't something Storybook should exercise.
 */
export const Default: Story = {
  args: {},
};
