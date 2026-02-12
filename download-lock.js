const downloadLocks = new Map();
const downloadPromises = new Map();

function createDownloadLock(key) {
  if (downloadLocks.has(key)) {
    return downloadPromises.get(key);
  }

  const promise = new Promise((resolve, reject) => {
    downloadLocks.set(key, { resolve, reject });
  });

  downloadPromises.set(key, promise);
  return promise;
}

function resolveDownloadLock(key, value) {
  const lock = downloadLocks.get(key);
  if (lock) {
    lock.resolve(value);
    downloadLocks.delete(key);
    downloadPromises.delete(key);
  }
}

function rejectDownloadLock(key, error) {
  const lock = downloadLocks.get(key);
  if (lock) {
    lock.reject(error);
    downloadLocks.delete(key);
    downloadPromises.delete(key);
  }
}

function getDownloadPromise(key) {
  return downloadPromises.get(key);
}

function isDownloading(key) {
  return downloadPromises.has(key);
}

module.exports = {
  createDownloadLock,
  resolveDownloadLock,
  rejectDownloadLock,
  getDownloadPromise,
  isDownloading
};
