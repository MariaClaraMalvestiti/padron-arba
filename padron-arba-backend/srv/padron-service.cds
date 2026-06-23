using { padron.arba as db } from '../db/schema';

service PadronService {
  entity Uploads as projection on db.Uploads;
  entity UploadRecords as projection on db.UploadRecords;
  entity UploadLogs as projection on db.UploadLogs;
  entity JobRuns as projection on db.JobRuns;
}
