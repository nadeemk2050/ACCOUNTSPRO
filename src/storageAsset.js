import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

const MOCK_STORAGE_PREFIX = 'https://mock-storage.local/';

export const isMockStorageUrl = (value) => (
    typeof value === 'string' && value.startsWith(MOCK_STORAGE_PREFIX)
);

export const resolveStoredImageUrl = async (image) => {
    if (!image) return null;

    if (typeof image === 'string') {
        return isMockStorageUrl(image) ? null : image;
    }

    if (image.url && !isMockStorageUrl(image.url)) {
        return image.url;
    }

    if (!image.storagePath) {
        return image.url || null;
    }

    try {
        return await getDownloadURL(ref(storage, image.storagePath));
    } catch (error) {
        console.warn('Failed to resolve stored image:', image.storagePath, error);
        return image.url || null;
    }
};

export const resolveStoredImages = async (images = []) => Promise.all(
    images.map(async (image) => ({
        ...image,
        url: await resolveStoredImageUrl(image)
    }))
);