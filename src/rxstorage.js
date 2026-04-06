const DB_NAME = 'accpro_offline_storage';
const STORE_NAME = 'files';

let dbPromise = null;

const openStorageDb = () => {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, 1);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'path' });
				}
			};

			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error || new Error('Failed to open offline storage database'));
		});
	}

	return dbPromise;
};

const runStoreRequest = async (mode, operation) => {
	const db = await openStorageDb();

	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, mode);
		const store = transaction.objectStore(STORE_NAME);
		const request = operation(store);

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('Offline storage request failed'));
	});
};

const readBlobAsDataUrl = (blob) => new Promise((resolve, reject) => {
	const reader = new FileReader();
	reader.onload = () => resolve(reader.result);
	reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
	reader.readAsDataURL(blob);
});

const normalizeToDataUrl = async (value, format = 'data_url', metadata = {}) => {
	if (value instanceof Blob) {
		return readBlobAsDataUrl(value);
	}

	if (typeof value !== 'string') {
		throw new Error('Unsupported upload payload for offline storage');
	}

	if (format === 'data_url') return value;
	if (format === 'base64') {
		return `data:${metadata.contentType || 'application/octet-stream'};base64,${value}`;
	}
	if (format === 'base64url') {
		const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
		return `data:${metadata.contentType || 'application/octet-stream'};base64,${normalized}`;
	}
	if (format === 'raw') {
		const encoded = btoa(unescape(encodeURIComponent(value)));
		return `data:${metadata.contentType || 'text/plain;charset=utf-8'};base64,${encoded}`;
	}

	throw new Error(`Unsupported upload format for offline storage: ${format}`);
};

const saveFileRecord = async (path, value, metadata = {}) => {
	const record = {
		path,
		dataUrl: await normalizeToDataUrl(value, metadata.format, metadata),
		contentType: metadata.contentType || (value && typeof value === 'object' ? value.type : undefined) || 'application/octet-stream',
		updatedAt: Date.now()
	};

	await runStoreRequest('readwrite', (store) => store.put(record));
	return record;
};

export const getStorage = () => ({ type: 'offline-indexeddb-storage' });

export const ref = (storage, path) => ({ storage, path });

export const uploadBytes = async (storageRef, data) => {
	const record = await saveFileRecord(storageRef.path, data, {
		contentType: data?.type,
		format: 'data_url'
	});

	return {
		ref: storageRef,
		metadata: {
			fullPath: storageRef.path,
			contentType: record.contentType
		}
	};
};

export const uploadString = async (storageRef, value, format = 'raw', metadata = {}) => {
	const record = await saveFileRecord(storageRef.path, value, {
		...metadata,
		format
	});

	return {
		ref: storageRef,
		metadata: {
			fullPath: storageRef.path,
			contentType: record.contentType
		}
	};
};

export const getDownloadURL = async (storageRef) => {
	const record = await runStoreRequest('readonly', (store) => store.get(storageRef.path));
	if (!record?.dataUrl) {
		throw new Error(`Offline storage file not found for path: ${storageRef.path}`);
	}
	return record.dataUrl;
};

export const deleteObject = async (storageRef) => {
	await runStoreRequest('readwrite', (store) => store.delete(storageRef.path));
};
