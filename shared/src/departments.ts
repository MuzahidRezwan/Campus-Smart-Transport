/**
 * DIU departments and where each publishes its notices (class routines among them).
 * The notice list is server-rendered at webbackend.daffodilvarsity.edu.bd; the
 * routine fetcher follows its newest "Class Routine" notice to the file.
 * Keep in step with DEPARTMENTS in backend/ml/app/demand.py.
 */
export interface DiuDepartment { code: string; slug: string; name: string }

export const DIU_DEPARTMENTS: readonly DiuDepartment[] = [
  { code: 'CSE', slug: 'cse', name: 'Computer Science and Engineering' },
  { code: 'SWE', slug: 'swe', name: 'Software Engineering' },
  { code: 'ICE', slug: 'ice', name: 'Information and Communication Engineering' },
  { code: 'EEE', slug: 'eee', name: 'Electrical and Electronic Engineering' },
  { code: 'CE', slug: 'ce', name: 'Civil Engineering' },
  { code: 'TE', slug: 'te', name: 'Textile Engineering' },
  { code: 'ARCH', slug: 'architecture', name: 'Architecture' },
  { code: 'RME', slug: 'rme', name: 'Robotics and Mechatronics Engineering' },
  { code: 'AIDE', slug: 'aide', name: 'Artificial Intelligence and Data Engineering' },
  { code: 'MCT', slug: 'mct', name: 'Multimedia and Creative Technology' },
  { code: 'CIS', slug: 'cis', name: 'Computing and Information System' },
  { code: 'ITM', slug: 'itm', name: 'Information Technology and Management' },
  { code: 'ESDM', slug: 'esdm', name: 'Environmental Science and Disaster Management' },
  { code: 'PESS', slug: 'pess', name: 'Physical Education and Sports Science' },
  { code: 'BBA', slug: 'bba', name: 'Business Administration' },
  { code: 'MGT', slug: 'mgt', name: 'Management' },
  { code: 'ACC', slug: 'accounting', name: 'Accounting' },
  { code: 'FIN', slug: 'finance', name: 'Finance and Banking' },
  { code: 'MKT', slug: 'mkt', name: 'Marketing' },
  { code: 'BRE', slug: 'bre', name: 'Real Estate' },
  { code: 'THM', slug: 'thm', name: 'Tourism and Hospitality Management' },
  { code: 'IE', slug: 'de', name: 'Innovation and Entrepreneurship' },
  { code: 'ENG', slug: 'english', name: 'English' },
  { code: 'LAW', slug: 'law', name: 'Law' },
  { code: 'JMC', slug: 'jmc', name: 'Journalism, Media and Communication' },
  { code: 'DS', slug: 'ds', name: 'Development Studies' },
  { code: 'ISLM', slug: 'islm', name: 'Information Science and Library Management' },
  { code: 'ICTE', slug: 'icted', name: 'ICT Education' },
  { code: 'PHAR', slug: 'pharmacy', name: 'Pharmacy' },
  { code: 'PH', slug: 'ph', name: 'Public Health' },
  { code: 'NFE', slug: 'nfe', name: 'Nutrition and Food Engineering' },
  { code: 'GEB', slug: 'geb', name: 'Genetic Engineering and Biotechnology' },
  { code: 'AGS', slug: 'ags', name: 'Agricultural Science' },
  { code: 'FISH', slug: 'fisheries', name: 'Fisheries' },
];

export const departmentNoticeUrl = (slug: string) => `https://webbackend.daffodilvarsity.edu.bd/department/${slug}/notice`;
