namespace padron.arba;

using { cuid, managed } from '@sap/cds/common';

entity Uploads : cuid, managed {
  fileName           : String(255);
  organism           : String(20) default 'ARBA';
  status             : String(30) default 'UPLOADED';
  totalRecords       : Integer default 0;
  processedRecords   : Integer default 0;
  createdRecords     : Integer default 0;
  updatedRecords     : Integer default 0;
  skippedRecords     : Integer default 0;
  errorRecords       : Integer default 0;
  message            : String(1000);
  startedAt          : Timestamp;
  finishedAt         : Timestamp;

  records            : Composition of many UploadRecords on records.upload = $self;
  logs               : Composition of many UploadLogs on logs.upload = $self;
  jobs               : Composition of many JobRuns on jobs.upload = $self;
}

entity UploadRecords : cuid, managed {
  upload             : Association to Uploads;
  lineNumber         : Integer;
  cuit               : String(20);
  customerId         : String(20);
  customerName       : String(255);
  publicationDate    : Date;
  validFrom          : Date;
  validTo            : Date;
  taxPayerType       : String(5);
  altaBaja           : String(5);
  cambioAlicuota     : String(5);
  rate               : Decimal(9, 4);
  groupCode          : String(10);
  conditionRecord    : String(30);
  suggestedAction    : String(30);
  status             : String(30) default 'PENDING';
  message            : String(1000);
}

entity UploadLogs : cuid, managed {
  upload             : Association to Uploads;
  record             : Association to UploadRecords;
  type               : String(20);
  message            : String(1000);
  technicalDetail    : LargeString;
}

entity JobRuns : cuid, managed {
  upload             : Association to Uploads;
  status             : String(30) default 'QUEUED';
  startedAt          : Timestamp;
  finishedAt         : Timestamp;
  totalRecords       : Integer default 0;
  processedRecords   : Integer default 0;
  errorMessage       : String(1000);
}
