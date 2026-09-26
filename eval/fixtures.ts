// Synthetic regression fixtures, NOT official SFC policies or a human-reviewed quality benchmark.
export const policies = [
  {
    id: "tuition",
    text: "Tuition payment is due September 15. A late payment fee of fifty dollars applies after the deadline.",
  },
  {
    id: "library",
    text: "Library books may be borrowed for fourteen days. Renewals are allowed unless another student has reserved the book.",
  },
  {
    id: "withdrawal",
    text: "Course withdrawal requests must be submitted to the registrar by October 20. Withdrawal after this deadline requires committee approval.",
  },
  {
    id: "attendance",
    text: "Students with more than three unexcused absences must meet with their instructor. Excused medical absences do not count toward the limit.",
  },
  {
    id: "graduation",
    text: "Graduation requires 120 credits and a cumulative GPA of at least 2.0. Students must complete all major requirements.",
  },
  {
    id: "scholarship",
    text: "Scholarship renewal requires a cumulative GPA of 3.2 and full-time enrollment. Part-time students are ineligible for renewal.",
  },
  {
    id: "housing",
    text: "Housing applications close June 1. Applicants must pay a refundable housing deposit of two hundred dollars.",
  },
  {
    id: "appeal",
    text: "Grade appeals must be submitted in writing within ten business days after final grades are posted.",
  },
  {
    id: "accessibility",
    text: "Accessibility accommodations are arranged through the disability services office. Students should submit documentation before the semester begins.",
  },
  {
    id: "parking",
    text: "Parking permits are required in the campus garage. Overnight parking is prohibited except with written authorization.",
  },
  {
    id: "refund",
    text: "Tuition refunds are one hundred percent before classes begin and fifty percent during the first week. No refunds are available after the first week.",
  },
  {
    id: "lab",
    text: "Laboratory safety training is mandatory before using chemistry equipment. Protective goggles must be worn during all experiments.",
  },
];
export const questions = [
  ["When is tuition payment due?", "tuition"],
  ["What is the late payment fee?", "tuition"],
  ["How long can I borrow library books?", "library"],
  ["Are library renewals allowed?", "library"],
  ["What is the course withdrawal deadline?", "withdrawal"],
  ["Who approves late withdrawal?", "withdrawal"],
  ["What is the unexcused absences limit?", "attendance"],
  ["Do medical absences count?", "attendance"],
  ["How many credits are required for graduation?", "graduation"],
  ["What GPA is required for graduation?", "graduation"],
  ["What GPA is required for scholarship renewal?", "scholarship"],
  ["Are part-time students eligible for scholarship renewal?", "scholarship"],
  ["When do housing applications close?", "housing"],
  ["How much is the housing deposit?", "housing"],
  ["When must grade appeals be submitted?", "appeal"],
  ["Do grade appeals need to be in writing?", "appeal"],
  ["Where are accessibility accommodations arranged?", "accessibility"],
  ["When should disability documentation be submitted?", "accessibility"],
  ["Are parking permits required?", "parking"],
  ["Is overnight parking allowed?", "parking"],
  ["What tuition refund is available during the first week?", "refund"],
  ["Are refunds available after the first week?", "refund"],
  ["Is laboratory safety training mandatory?", "lab"],
  ["Must protective goggles be worn?", "lab"],
] as const;
export const unanswerable = [
  "dinosaur spaceship",
  "volcano submarine",
  "galaxy elephants",
  "cryptocurrency asteroid",
];
