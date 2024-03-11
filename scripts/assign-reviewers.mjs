import fs from 'fs';
// import yaml from 'js-yaml';
import path from 'path';

import { exec } from 'child_process';
import {parseFeatureOwners} from './parsefeatureowners.mjs';

const execPromise = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(stderr);
                reject(error);
            }
            resolve(stdout.trim());
        });
    });
};

const getFeatureOwners = () => {
    // const featureOwners = yaml.safeLoad(fs.readFileSync('../.github/FEATUREOWNERS', 'utf8'));
    // const featureName = path.basename(featureFile, '.yml');
    // return featureOwners[featureName] || featureOwners['*'];
    const content = fs.readFileSync('../.github/FEATUREOWNERS', 'utf8');
    const mappings = parseFeatureOwners(content);
    // console.log(mappings);
    return mappings;
};

const assignReviewers = async () => {

    let files = await execPromise(`git diff --name-only HEAD~1 HEAD`);
    files = files.split('\n').filter(Boolean);

    const featureFiles = files.filter(file => file.endsWith('.yml'));

    console.log('Files:', files);

    const owners = getFeatureOwners();

    console.log('Owners:', owners);
   
};

assignReviewers().catch(err => {
    console.error(err);
    process.exit(1);
});