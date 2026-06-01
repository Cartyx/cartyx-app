import { describe, it, expect } from 'vitest';

describe('location schemas', () => {
  it('createLocationSchema rejects empty name', async () => {
    const { createLocationSchema } = await import('~/types/schemas/locations');
    const result = createLocationSchema.safeParse({
      campaignId: 'abc',
      name: '',
      locationType: 'city',
    });
    expect(result.success).toBe(false);
  });

  it('createLocationSchema rejects missing locationType', async () => {
    const { createLocationSchema } = await import('~/types/schemas/locations');
    const result = createLocationSchema.safeParse({
      campaignId: 'abc',
      name: 'Waterdeep',
      locationType: '',
    });
    expect(result.success).toBe(false);
  });

  it('createLocationSchema accepts valid input', async () => {
    const { createLocationSchema } = await import('~/types/schemas/locations');
    const result = createLocationSchema.safeParse({
      campaignId: 'abc',
      name: 'Waterdeep',
      locationType: 'city',
      description: 'A great city',
      isPublic: true,
      parentLocations: ['parent1'],
      tags: ['forgotten-realms'],
    });
    expect(result.success).toBe(true);
  });

  it('listLocationsSchema accepts locationType filter', async () => {
    const { listLocationsSchema } = await import('~/types/schemas/locations');
    const result = listLocationsSchema.safeParse({
      campaignId: 'abc',
      locationType: 'city',
    });
    expect(result.success).toBe(true);
  });

  it('createLocationTypeSchema rejects empty name', async () => {
    const { createLocationTypeSchema } = await import('~/types/schemas/locations');
    const result = createLocationTypeSchema.safeParse({
      campaignId: 'abc',
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('createLocationTypeSchema accepts valid input', async () => {
    const { createLocationTypeSchema } = await import('~/types/schemas/locations');
    const result = createLocationTypeSchema.safeParse({
      campaignId: 'abc',
      name: 'island',
    });
    expect(result.success).toBe(true);
  });

  it('addLocationImageSchema rejects empty title', async () => {
    const { addLocationImageSchema } = await import('~/types/schemas/locations');
    const result = addLocationImageSchema.safeParse({
      id: 'loc1',
      campaignId: 'abc',
      imageKey: 'uploads/locations/123.webp',
      url: 'https://cdn.example.com/uploads/locations/123.webp',
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('addLocationImageSchema rejects invalid URL', async () => {
    const { addLocationImageSchema } = await import('~/types/schemas/locations');
    const result = addLocationImageSchema.safeParse({
      id: 'loc1',
      campaignId: 'abc',
      imageKey: 'uploads/locations/123.webp',
      url: 'not-a-url',
      title: 'City skyline',
    });
    expect(result.success).toBe(false);
  });

  it('addLocationImageSchema accepts valid input', async () => {
    const { addLocationImageSchema } = await import('~/types/schemas/locations');
    const result = addLocationImageSchema.safeParse({
      id: 'loc1',
      campaignId: 'abc',
      imageKey: 'uploads/locations/123.webp',
      url: 'https://cdn.example.com/uploads/locations/123.webp',
      title: 'City skyline at sunset',
    });
    expect(result.success).toBe(true);
  });

  it('deleteLocationImageSchema rejects empty imageKey', async () => {
    const { deleteLocationImageSchema } = await import('~/types/schemas/locations');
    const result = deleteLocationImageSchema.safeParse({
      id: 'loc1',
      campaignId: 'abc',
      imageKey: '',
    });
    expect(result.success).toBe(false);
  });

  it('deleteLocationImageSchema accepts valid input', async () => {
    const { deleteLocationImageSchema } = await import('~/types/schemas/locations');
    const result = deleteLocationImageSchema.safeParse({
      id: 'loc1',
      campaignId: 'abc',
      imageKey: 'uploads/locations/123.webp',
    });
    expect(result.success).toBe(true);
  });
});
