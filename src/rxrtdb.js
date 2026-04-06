export const getDatabase = () => ({});
export const ref = (db, path) => ({ 
    path,
    set: async () => {},
    update: async () => {},
    push: () => ({ key: 'temp_' + Date.now() }),
    remove: async () => {},
    onDisconnect: () => ({ set: () => {}, remove: () => {} })
});
export const set = async () => { };
export const push = async () => ({ key: 'temp_' + Date.now() });
export const update = async () => { };
export const remove = async () => { };
export const onDisconnect = () => ({ 
    set: () => { }, 
    remove: () => { },
    update: () => { }
});
export const onValue = (r, cb) => { cb({ val: () => null, exists: () => false }); return () => { }; };
export const serverTimestamp = () => Date.now();
