# SOLID Community Server with Cloud Storage
An experiment to see whether there is opportunity to build a SOLID server implementation
that allows Pod storage in the Cloud.

Hypothesis:
1. If a service provided options to store Pod data in the cloud, users could "own" there
storage, but be provided a service in order to expose that data for SOLID protocal applications.
2. Users would want/need assistance with creating cloud storage (AWS, GCP, Azure), and they could
control everything by simply pointing this service at their own "bucket".
3. Some users would want/need for this service to control the entire flow and build out the bucket
for them, while maybe giving them the choice of vendor (AWS, GCP, Azure).
