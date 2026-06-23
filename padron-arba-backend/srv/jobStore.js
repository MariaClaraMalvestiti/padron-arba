const jobs = new Map();

function createJob(payload) {
    const id = "JOB-" + Date.now() + "-" + Math.floor(Math.random() * 10000);

    const job = {
        id,
        status: "PENDING",
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        payload,
        result: null,
        error: null
    };

    jobs.set(id, job);
    return job;
}

function getJob(id) {
    return jobs.get(id) || null;
}

function updateJob(id, changes) {
    const job = getJob(id);
    if (!job) return null;

    Object.assign(job, changes);
    jobs.set(id, job);

    return job;
}

function listJobs() {
    return Array.from(jobs.values()).sort(function (a, b) {
        return b.createdAt.localeCompare(a.createdAt);
    });
}

module.exports = {
    createJob,
    getJob,
    updateJob,
    listJobs
};
