import { RepositoryProvider } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CallsiteDetectorService } from './callsite-detector.service';
import { DependencyAnalyzerService } from './dependency-analyzer.service';
import { ImpactAnalysisService } from './impact-analysis.service';
import { ImpactClassifierService } from './impact-classifier.service';
import { RemoteCodeSearchService } from './remote-code-search.service';

describe('ImpactAnalysisService', () => {
  let service: ImpactAnalysisService;
  let prismaService: PrismaService;
  let callsiteDetector: CallsiteDetectorService;
  let dependencyAnalyzer: DependencyAnalyzerService;
  let impactClassifier: ImpactClassifierService;

  const mockPrismaService = {
    regressionReport: {
      create: jest.fn(),
    },
  };

  const mockCallsiteDetector = {
    extractFunctionsFromFile: jest.fn(),
    findCallsites: jest.fn(),
  };

  const mockDependencyAnalyzer = {
    buildDependencyMap: jest.fn(),
  };

  const mockImpactClassifier = {
    classifyChanges: jest.fn(),
    performRiskAssessment: jest.fn(),
  };

const mockRemoteCodeSearch = {
  searchFunctionReferences: jest.fn(),
};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpactAnalysisService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: CallsiteDetectorService,
          useValue: mockCallsiteDetector,
        },
        {
          provide: DependencyAnalyzerService,
          useValue: mockDependencyAnalyzer,
        },
        {
          provide: ImpactClassifierService,
          useValue: mockImpactClassifier,
        },
        {
          provide: RemoteCodeSearchService,
          useValue: mockRemoteCodeSearch,
        },
      ],
    }).compile();

    service = module.get<ImpactAnalysisService>(ImpactAnalysisService);
    prismaService = module.get<PrismaService>(PrismaService);
    callsiteDetector = module.get<CallsiteDetectorService>(
      CallsiteDetectorService,
    );
    dependencyAnalyzer = module.get<DependencyAnalyzerService>(
      DependencyAnalyzerService,
    );
    impactClassifier = module.get<ImpactClassifierService>(
      ImpactClassifierService,
    );
    mockRemoteCodeSearch.searchFunctionReferences.mockReset();
    mockRemoteCodeSearch.searchFunctionReferences.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeImpact', () => {
    it('should perform enhanced impact analysis', async () => {
      const repositoryId = 'test-repo-id';
      const prNumber = 123;
      const changedFiles = [
        {
          filename: 'src/components/Button.tsx',
          status: 'modified',
          patch: 'diff content',
        },
      ];
      const organizationId = 'test-org-id';

      const mockChangedFunctions = [
        {
          name: 'handleClick',
          file: 'src/components/Button.tsx',
          line: 10,
          changeType: 'MODIFIED' as const,
          previousSignature: 'handleClick(event: MouseEvent)',
          newSignature:
            'handleClick(event: MouseEvent, options?: ClickOptions)',
          impactScope: 'LOCAL' as const,
          confidence: 'HIGH' as const,
          codeType: 'FUNCTION' as const,
        },
      ];

      const mockCallsites = [
        {
          functionName: 'handleClick',
          file: 'src/components/Button.tsx',
          line: 15,
          column: 5,
          callCode: 'handleClick(event)',
          callType: 'DIRECT' as const,
          compatibilityStatus: 'WILL_WORK' as const,
          priority: 'MEDIUM' as const,
          estimatedFixTime: '5 minutes',
          context: {
            callFrequency: 'FREQUENT' as const,
            callContext: 'React component',
            isInSameDirectory: true,
            isInSameModule: true,
          },
        },
      ];

      const mockBreakingChanges = [];
      const mockCompatibleChanges = [
        {
          id: 'compatible-1',
          functionName: 'handleClick',
          file: 'src/components/Button.tsx',
          line: 10,
          description:
            'Function handleClick has been modified but remains backward compatible',
          compatibilityReason: 'Added optional parameter',
          potentialRisks: [],
          monitoringRecommendations: [],
        },
      ];

      const mockRiskAssessment = {
        overallRisk: 'LOW' as const,
        riskFactors: [],
        mitigationStrategies: [],
        estimatedFixTime: '5 minutes',
        deploymentReadiness: 95,
      };

      mockCallsiteDetector.extractFunctionsFromFile.mockResolvedValue(
        mockChangedFunctions,
      );
      mockDependencyAnalyzer.buildDependencyMap.mockResolvedValue({});
      mockCallsiteDetector.findCallsites.mockResolvedValue(mockCallsites);
      mockImpactClassifier.classifyChanges.mockResolvedValue({
        breakingChanges: mockBreakingChanges,
        compatibleChanges: mockCompatibleChanges,
      });
      mockImpactClassifier.performRiskAssessment.mockResolvedValue(
        mockRiskAssessment,
      );
      mockPrismaService.regressionReport.create.mockResolvedValue({});

      const result = await service.analyzeImpact(
        repositoryId,
        prNumber,
        changedFiles,
        organizationId,
      );

      expect(result).toBeDefined();
      expect(result.changedFunctions).toEqual(mockChangedFunctions);
      expect(result.impactedCallsites).toEqual(mockCallsites);
      expect(result.breakingChanges).toEqual(mockBreakingChanges);
      expect(result.compatibleChanges).toEqual(mockCompatibleChanges);
      expect(result.riskAssessment).toEqual(mockRiskAssessment);
      expect(result.deploymentRecommendation).toBe('SAFE');
      expect(mockPrismaService.regressionReport.create).toHaveBeenCalled();
    });

    it('should handle breaking changes correctly', async () => {
      const repositoryId = 'test-repo-id';
      const prNumber = 123;
      const changedFiles = [
        {
          filename: 'src/utils/api.ts',
          status: 'modified',
          patch: 'diff content',
        },
      ];
      const organizationId = 'test-org-id';

      const mockChangedFunctions = [
        {
          name: 'fetchUser',
          file: 'src/utils/api.ts',
          line: 5,
          changeType: 'MODIFIED' as const,
          previousSignature: 'fetchUser(id: string)',
          newSignature: 'fetchUser(id: string, includeProfile: boolean)',
          impactScope: 'SYSTEM' as const,
          confidence: 'HIGH' as const,
          codeType: 'FUNCTION' as const,
        },
      ];

      const mockCallsites = [
        {
          functionName: 'fetchUser',
          file: 'src/components/UserProfile.tsx',
          line: 20,
          column: 10,
          callCode: 'fetchUser(userId)',
          callType: 'DIRECT' as const,
          compatibilityStatus: 'WILL_BREAK' as const,
          priority: 'HIGH' as const,
          estimatedFixTime: '15 minutes',
          context: {
            callFrequency: 'FREQUENT' as const,
            callContext: 'React component',
            isInSameDirectory: false,
            isInSameModule: false,
          },
        },
      ];

      const mockBreakingChanges = [
        {
          id: 'breaking-1',
          functionName: 'fetchUser',
          file: 'src/components/UserProfile.tsx',
          line: 20,
          description:
            'Function fetchUser has added required parameters: includeProfile',
          evidence:
            'Function fetchUser called at src/components/UserProfile.tsx:20 will break due to signature changes',
          failureCondition:
            'Calling fetchUser with current parameters will result in runtime error',
          impactScope: 'SYSTEM' as const,
          mitigation: 'Add required parameters: includeProfile',
          relatedCallsites: ['src/components/UserProfile.tsx'],
          severity: 'HIGH' as const,
        },
      ];

      const mockCompatibleChanges = [];

      const mockRiskAssessment = {
        overallRisk: 'HIGH' as const,
        riskFactors: [
          '1 high severity breaking changes',
          '1 system-wide impacts',
        ],
        mitigationStrategies: [
          'Review and fix high severity changes',
          'Implement gradual rollout for system changes',
        ],
        estimatedFixTime: '15 minutes',
        deploymentReadiness: 60,
      };

      mockCallsiteDetector.extractFunctionsFromFile.mockResolvedValue(
        mockChangedFunctions,
      );
      mockDependencyAnalyzer.buildDependencyMap.mockResolvedValue({});
      mockCallsiteDetector.findCallsites.mockResolvedValue(mockCallsites);
      mockImpactClassifier.classifyChanges.mockResolvedValue({
        breakingChanges: mockBreakingChanges,
        compatibleChanges: mockCompatibleChanges,
      });
      mockImpactClassifier.performRiskAssessment.mockResolvedValue(
        mockRiskAssessment,
      );
      mockPrismaService.regressionReport.create.mockResolvedValue({});

      const result = await service.analyzeImpact(
        repositoryId,
        prNumber,
        changedFiles,
        organizationId,
      );

      expect(result).toBeDefined();
      expect(result.breakingChanges).toEqual(mockBreakingChanges);
      expect(result.deploymentRecommendation).toBe('REVIEW_REQUIRED');
    });

    it('should handle errors gracefully', async () => {
      const repositoryId = 'test-repo-id';
      const prNumber = 123;
      const changedFiles = [
        {
          filename: 'invalid-file.txt',
          status: 'modified',
          patch: 'diff content',
        },
      ];
      const organizationId = 'test-org-id';

      mockCallsiteDetector.extractFunctionsFromFile.mockRejectedValue(
        new Error('File parsing error'),
      );

      await expect(
        service.analyzeImpact(
          repositoryId,
          prNumber,
          changedFiles,
          organizationId,
        ),
      ).rejects.toThrow();
    });

    it('should include remote callsite matches detected via search', async () => {
      const repositoryId = 'test-repo-id';
      const prNumber = 321;
      const changedFiles = [
        {
          filename: 'src/components/Button.tsx',
          status: 'modified',
          patch: 'diff content',
        },
      ];
      const organizationId = 'test-org-id';

      const mockChangedFunctions = [
        {
          name: 'handleClick',
          file: 'src/components/Button.tsx',
          line: 10,
          changeType: 'MODIFIED' as const,
          previousSignature: 'handleClick(event: MouseEvent)',
          newSignature: 'handleClick(event: MouseEvent)',
          impactScope: 'MODULE' as const,
          confidence: 'MEDIUM' as const,
          codeType: 'FUNCTION' as const,
        },
      ];

      const mockRemoteMatches = [
        {
          provider: RepositoryProvider.GITHUB,
          branch: 'feature/ui',
          filePath: 'src/pages/Dashboard.tsx',
          line: 42,
          snippet: '<Button onClick={handleClick} />',
          url: 'https://github.com/org/repo/blob/feature/ui/src/pages/Dashboard.tsx#L42',
        },
      ];

      mockCallsiteDetector.extractFunctionsFromFile.mockResolvedValue(
        mockChangedFunctions,
      );
      mockDependencyAnalyzer.buildDependencyMap.mockResolvedValue({});
      mockCallsiteDetector.findCallsites.mockResolvedValue([]);
      mockImpactClassifier.classifyChanges.mockResolvedValue({
        breakingChanges: [],
        compatibleChanges: [],
      });
      mockImpactClassifier.performRiskAssessment.mockResolvedValue({
        overallRisk: 'LOW',
        riskFactors: [],
        mitigationStrategies: [],
        estimatedFixTime: '5 minutes',
        deploymentReadiness: 100,
      });
      mockPrismaService.regressionReport.create.mockResolvedValue({});
      mockRemoteCodeSearch.searchFunctionReferences.mockResolvedValue(
        mockRemoteMatches,
      );

      const result = await service.analyzeImpact(
        repositoryId,
        prNumber,
        changedFiles,
        organizationId,
      );

      expect(result.impactedCallsites).toHaveLength(1);
      expect(result.impactedCallsites[0].callType).toBe('REMOTE_SEARCH');
      expect(result.impactedCallsites[0].context.branchName).toBe('feature/ui');
      expect(
        mockRemoteCodeSearch.searchFunctionReferences,
      ).toHaveBeenCalledWith({
        repositoryId,
        functionName: 'handleClick',
        filePath: 'src/components/Button.tsx',
        prNumber,
        codeType: 'FUNCTION',
      });
    });
  });
});
