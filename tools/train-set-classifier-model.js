const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const classifierRoot = path.join(projectRoot, 'tools', 'set-classifier');
const defaultDebugPath = path.join(classifierRoot, 'model-debug', 'set-classifier-debug.json');
const defaultOutputPath = path.join(classifierRoot, 'model-debug', 'set-classifier-model.json');

function parseArgs(argv) {
  const args = {
    input: defaultDebugPath,
    output: defaultOutputPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input' && argv[index + 1]) {
      args.input = path.resolve(argv[index + 1]);
      index += 1;
    } else if (token === '--output' && argv[index + 1]) {
      args.output = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toNumberArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => Number(entry) || 0);
}

function trainProfileModel(profile, samples) {
  if (!samples.length) {
    return null;
  }

  const labels = [...new Set(samples.map((sample) => sample.set))].sort();
  if (labels.length < 2) {
    return null;
  }

  const featureCount = samples[0].features.length;
  if (!featureCount) {
    return null;
  }

  const labelToIndex = new Map(labels.map((label, index) => [label, index]));
  const mean = new Array(featureCount).fill(0);
  for (const sample of samples) {
    for (let index = 0; index < featureCount; index += 1) {
      mean[index] += sample.features[index];
    }
  }
  for (let index = 0; index < featureCount; index += 1) {
    mean[index] /= samples.length;
  }

  const scale = new Array(featureCount).fill(0);
  for (const sample of samples) {
    for (let index = 0; index < featureCount; index += 1) {
      const delta = sample.features[index] - mean[index];
      scale[index] += delta * delta;
    }
  }
  for (let index = 0; index < featureCount; index += 1) {
    const variance = scale[index] / samples.length;
    scale[index] = Math.max(0.05, Math.sqrt(variance));
  }

  const normalizedSamples = samples.map((sample) => ({
    set: sample.set,
    features: sample.features.map((value, index) => (value - mean[index]) / scale[index]),
  }));

  const classCounts = new Array(labels.length).fill(0);
  for (const sample of normalizedSamples) {
    const classIndex = labelToIndex.get(sample.set);
    classCounts[classIndex] += 1;
  }
  const maxClassCount = Math.max(...classCounts, 1);
  const classWeights = classCounts.map((count) => maxClassCount / Math.max(1, count));

  const weights = labels.map(() => new Array(featureCount).fill(0));
  const biases = new Array(labels.length).fill(0);
  const learningRate = profile === 'arrow' ? 0.08 : 0.12;
  const regularization = profile === 'arrow' ? 0.0016 : 0.0010;
  const epochs = profile === 'arrow' ? 520 : 320;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const weightGradients = labels.map(() => new Array(featureCount).fill(0));
    const biasGradients = new Array(labels.length).fill(0);
    let totalExampleWeight = 0;

    for (const sample of normalizedSamples) {
      const logits = labels.map((_, classIndex) => {
        let total = biases[classIndex];
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
          total += weights[classIndex][featureIndex] * sample.features[featureIndex];
        }
        return total;
      });

      const maxLogit = Math.max(...logits);
      const expValues = logits.map((value) => Math.exp(value - maxLogit));
      const expTotal = expValues.reduce((total, value) => total + value, 0);
      if (!expTotal) {
        continue;
      }
      const probabilities = expValues.map((value) => value / expTotal);
      const targetIndex = labelToIndex.get(sample.set);
      const exampleWeight = classWeights[targetIndex];
      totalExampleWeight += exampleWeight;

      for (let classIndex = 0; classIndex < labels.length; classIndex += 1) {
        const error = (probabilities[classIndex] - (classIndex === targetIndex ? 1 : 0)) * exampleWeight;
        biasGradients[classIndex] += error;
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
          weightGradients[classIndex][featureIndex] += error * sample.features[featureIndex];
        }
      }
    }

    const sampleWeight = Math.max(1, totalExampleWeight);
    for (let classIndex = 0; classIndex < labels.length; classIndex += 1) {
      biases[classIndex] -= learningRate * (biasGradients[classIndex] / sampleWeight);
      for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
        const gradient =
          (weightGradients[classIndex][featureIndex] / sampleWeight) +
          (weights[classIndex][featureIndex] * regularization);
        weights[classIndex][featureIndex] -= learningRate * gradient;
      }
    }
  }

  return {
    profile,
    labels,
    weights,
    biases,
    mean,
    scale,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) {
    throw new Error(`Input debug file not found: ${args.input}`);
  }

  const parsed = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  if (!Array.isArray(parsed.samples)) {
    throw new Error('Debug file must contain a top-level "samples" array.');
  }

  const grouped = new Map();
  for (const sample of parsed.samples) {
    if (!sample || typeof sample !== 'object') {
      continue;
    }
    const profile = String(sample.profile || 'generic');
    const setName = String(sample.set || '');
    const features = toNumberArray(sample.features);
    if (!setName || !features.length) {
      continue;
    }
    if (!grouped.has(profile)) {
      grouped.set(profile, []);
    }
    grouped.get(profile).push({ set: setName, features });
  }

  const profiles = [];
  for (const [profile, samples] of grouped.entries()) {
    const trained = trainProfileModel(profile, samples);
    if (trained) {
      profiles.push(trained);
    }
  }

  ensureDir(path.dirname(args.output));
  fs.writeFileSync(
    args.output,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), profiles }, null, 2)}\n`,
    'utf8'
  );

  console.log(`Wrote model: ${args.output}`);
  profiles.forEach((profile) => {
    console.log(`${profile.profile}: ${profile.labels.length} labels, ${profile.mean.length} features`);
  });
}

main();
